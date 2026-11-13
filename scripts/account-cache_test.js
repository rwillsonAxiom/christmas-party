import { AccountCache } from "../public/account-cache.js";

function assert(value, message = "Assertion failed") {
  if (!value) throw new Error(message);
}
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
const alice = { id: "alice", name: "Alice", balance: 2 };
function cache(api, options = {}) {
  const errors = [];
  const result = new AccountCache({
    api,
    cacheStorage: storage(),
    queueStorage: storage(),
    key: "test",
    onChange() {},
    onError: (error) => errors.push(error),
    ...options,
  });
  result.remember(alice);
  return { result, errors };
}

Deno.test("queued edits apply immediately and send in order without double counting", async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const { result } = cache((path, body) => {
    calls.push({ path, body });
    return calls.length === 1 ? first.promise : second.promise;
  });
  result.enqueue("alice", 1, "receipt-1");
  result.enqueue("alice", -1, "receipt-2");
  assert(result.get("alice").balance === 2);
  assert(calls.length === 1, "Serialize requests");
  first.resolve({ ...alice, balance: 3 });
  await settle();
  assert(
    result.get("alice").balance === 2,
    "Include the unacknowledged delta only once",
  );
  assert(calls.length === 2);
  second.resolve(alice);
  await settle();
  assert(result.get("alice").balance === 2);
  assert(result.queue.length === 0);
});

Deno.test("reload restores queued deltas and retries a lost acknowledgement with the same receipt", async () => {
  const queueStorage = storage();
  const { result, errors } = cache(() => Promise.reject(new Error("Offline")), {
    queueStorage,
  });
  result.enqueue("alice", 1, "receipt-1");
  await settle();
  assert(errors.length === 1 && result.failed);
  assert(result.get("alice").balance === 3);
  let receipt;
  const restored = new AccountCache({
    api: (_path, operation) => {
      receipt = operation;
      return Promise.resolve({ ...alice, balance: 3 });
    },
    cacheStorage: storage(),
    queueStorage,
    key: "test",
    onChange() {},
    onError(error) {
      throw error;
    },
  });
  assert(restored.get("alice").balance === 3);
  await restored.drain();
  assert(receipt.requestId === "receipt-1");
  assert(restored.get("alice").balance === 3);
  assert(restored.queue.length === 0);
});

Deno.test("reads started before a write cannot overwrite its acknowledgement", async () => {
  const read = deferred();
  const { result } = cache((_path, operation) =>
    operation ? Promise.resolve({ ...alice, balance: 3 }) : read.promise
  );
  const refresh = result.refresh("alice");
  result.enqueue("alice", 1, "receipt-1");
  await settle();
  read.resolve(alice);
  await refresh;
  assert(result.get("alice").balance === 3);
});

Deno.test("preloading all accounts preserves pending deltas and reconciles other devices", async () => {
  const write = deferred();
  const { result } = cache((_path, operation) =>
    operation ? write.promise : Promise.resolve({
      accounts: [{ ...alice, balance: 99 }, {
        id: "bob",
        name: "Bob",
        balance: 6,
      }],
    })
  );
  result.enqueue("alice", 1, "receipt-1");
  await result.refreshAll();
  assert(result.get("alice").balance === 3);
  assert(result.get("bob").balance === 6);
  write.resolve({ ...alice, balance: 3 });
  await settle();
});

Deno.test("definitive server rejection undoes the optimistic change and opens an error", async () => {
  const { result, errors } = cache((_path, operation) =>
    operation
      ? Promise.reject(
        Object.assign(new Error("No credits left"), { status: 409 }),
      )
      : Promise.resolve({ ...alice, balance: 0 })
  );
  result.enqueue("alice", -1, "receipt-1");
  assert(result.get("alice").balance === 1);
  await settle();
  assert(result.get("alice").balance === 0);
  assert(result.queue.length === 0);
  assert(result.failed && errors.length === 1);
  await result.retry();
  assert(!result.failed);
});

Deno.test("failed local queue persistence never sends or applies a credit", () => {
  let called = false;
  const { result } = cache(() => {
    called = true;
  }, {
    queueStorage: {
      getItem() {},
      setItem() {
        throw new Error("Full");
      },
    },
  });
  let rejected = false;
  try {
    result.enqueue("alice", 1, "receipt-1");
  } catch {
    rejected = true;
  }
  assert(rejected && !called);
  assert(result.get("alice").balance === 2);
  assert(result.queue.length === 0);
});

Deno.test("an acknowledgement storage failure keeps a safely retryable receipt", async () => {
  const queueStorage = storage();
  const save = queueStorage.setItem;
  let failSave = false;
  queueStorage.setItem = (...args) => {
    if (failSave) throw new Error("Storage full");
    save(...args);
  };
  const write = deferred();
  const { result, errors } = cache(() => write.promise, { queueStorage });
  result.enqueue("alice", 1, "receipt-1");
  failSave = true;
  write.resolve({ ...alice, balance: 3 });
  await settle();
  assert(errors.length === 1 && result.failed);
  assert(result.queue[0].requestId === "receipt-1");
  assert(
    result.get("alice").balance === 3,
    "Do not double count the acknowledged delta",
  );
  failSave = false;
  await result.retry();
  assert(result.queue.length === 0 && result.get("alice").balance === 3);
});

Deno.test("a rejection cancels dependent edits but retains other accounts' changes", async () => {
  const write = deferred();
  const { result } = cache((_path, operation) =>
    operation ? write.promise : Promise.resolve(alice)
  );
  result.remember({ id: "bob", name: "Bob", balance: 3 });
  result.enqueue("alice", -1, "receipt-1");
  result.enqueue("alice", -1, "receipt-2");
  result.enqueue("bob", 1, "receipt-3");
  write.reject(Object.assign(new Error("No credits left"), { status: 409 }));
  await settle();
  assert(result.queue.length === 1 && result.queue[0].accountId === "bob");
  assert(result.get("alice").balance === 2);
  assert(result.get("bob").balance === 4);
});
