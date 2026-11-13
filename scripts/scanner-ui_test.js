// Exercise the actual frontend with a small DOM and camera/API doubles.
// Hardware detection and mobile layout still need an HTTPS phone check.
const source = (await Deno.readTextFile(
  new URL("../public/app.js", import.meta.url),
)).replace('import { config } from "./config.js";', "")
  .replace('await import("./scanner.js")', "await scanner()");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function assert(value, message = "Assertion failed") {
  if (!value) throw new Error(message);
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function setup({ cameraFailure = false } = {}) {
  const nodes = new Map();
  function node() {
    const classes = new Set();
    return {
      textContent: "",
      hidden: false,
      disabled: false,
      classList: {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        contains: (value) => classes.has(value),
      },
      append() {},
      replaceChildren() {},
      set innerHTML(html) {
        for (const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) {
          const child = node();
          child.disabled = match[0].includes(" disabled");
          child.hidden = match[0].includes(" hidden");
          nodes.set(`#${match[1]}`, child);
        }
      },
    };
  }
  for (
    const selector of [
      "#app",
      "#message",
      "#print-cards",
      "#staff-nav",
      ".credit-actions",
    ]
  ) nodes.set(selector, node());
  const document = {
    body: node(),
    querySelector: (selector) => nodes.get(selector),
    createElement: node,
    addEventListener() {},
  };
  const events = new Map();
  const window = {
    addEventListener: (name, callback) => events.set(name, callback),
  };
  const location = {
    hash: "#/scan",
    origin: "https://example.test",
    replace(value) {
      this.hash = value;
    },
  };
  let detect;
  let stopped = false;
  const requests = [];
  let creditResult;
  let accountResult;
  const balances = { alice: 2, bob: 0 };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    let result;
    if (url.endsWith("/session")) result = { authenticated: true };
    else if (url.endsWith("/credits")) {
      const id = url.split("/").at(-2);
      if (creditResult) return await creditResult;
      balances[id] += JSON.parse(options.body).delta;
      result = { id, name: id, balance: balances[id] };
    } else {
      if (accountResult) return await accountResult;
      const id = url.split("/").at(-1);
      result = { id, name: id, balance: balances[id] };
    }
    return { ok: true, json: () => Promise.resolve(result) };
  };
  const scanner = async () => ({
    cardIdFromCode: (code) => code === "invalid" ? undefined : code,
    startScanner: (_video, onCode) => {
      if (cameraFailure) throw new Error("Camera unavailable");
      detect = onCode;
      return { stop: () => stopped = true };
    },
  });
  await new AsyncFunction(
    "config",
    "document",
    "window",
    "location",
    "localStorage",
    "fetch",
    "scanner",
    source,
  )(
    { apiBaseUrl: "" },
    document,
    window,
    location,
    { getItem: () => "staff", setItem() {}, removeItem() {} },
    fetch,
    scanner,
  );
  return {
    nodes,
    requests,
    document,
    location,
    detect: (code) => detect(code),
    setCreditResult: (value) => creditResult = value,
    setAccountResult: (value) => accountResult = value,
    leave: () => {
      location.hash = "#/login";
      return events.get("hashchange")();
    },
    stopped: () => stopped,
  };
}

Deno.test("scanner starts automatically and switches cards without writing credits", async () => {
  const ui = await setup();
  assert(ui.document.body.classList.contains("scanning"));
  assert(ui.nodes.get("#camera-start").hidden);
  assert(ui.nodes.get("#add").disabled);
  assert(ui.detect("invalid") === false);
  assert(ui.detect("alice") === false, "Detection must keep running");
  await settle();
  assert(ui.nodes.get("#person-name").textContent === "alice");
  const count = ui.requests.length;
  ui.detect("alice");
  await settle();
  assert(ui.requests.length === count, "Same card must not reload");
  assert(ui.detect("bob") === false);
  assert(ui.nodes.get("#add").disabled, "Disable credits while switching");
  await settle();
  assert(ui.nodes.get("#person-name").textContent === "bob");
  assert(ui.nodes.get("#credit-value").textContent === "0");
  assert(
    ui.nodes.get("#remove").disabled,
    "Zero balance cannot be decremented",
  );
  assert(ui.requests.every(({ options }) => options.method === "GET"));
});

Deno.test("scanner holds the account through writes and uncertain retries", async () => {
  const ui = await setup();
  ui.detect("alice");
  await settle();
  let rejectWrite;
  ui.setCreditResult(new Promise((_, reject) => rejectWrite = reject));
  const write = ui.nodes.get("#add").onclick();
  ui.detect("bob");
  await settle();
  assert(ui.nodes.get("#person-name").textContent === "alice");
  rejectWrite(new Error("Connection lost"));
  await write;
  ui.detect("bob");
  await settle();
  assert(ui.nodes.get("#person-name").textContent === "alice");
  assert(ui.nodes.get("#remove").disabled, "Only the same operation can retry");
  assert(ui.nodes.get("#change-status").classList.contains("scan-warning"));
  ui.setCreditResult(Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ id: "alice", name: "alice", balance: 3 }),
  }));
  await ui.nodes.get("#add").onclick();
  const writes = ui.requests.filter(({ options }) => options.method === "POST");
  assert(writes.length === 2);
  assert(
    writes[0].options.body === writes[1].options.body,
    "Reuse retry receipt",
  );
  assert(ui.nodes.get("#credit-value").textContent === "3");
  assert(!ui.nodes.get("#change-status").classList.contains("scan-warning"));
  ui.detect("bob");
  await settle();
  assert(ui.nodes.get("#person-name").textContent === "bob");
});

Deno.test("leaving scanner stops camera and ignores late account loads", async () => {
  const ui = await setup();
  let finish;
  ui.setAccountResult(new Promise((resolve) => finish = resolve));
  ui.detect("alice");
  await ui.leave();
  assert(ui.stopped());
  assert(!ui.document.body.classList.contains("scanning"));
  finish({
    ok: true,
    json: () => Promise.resolve({ id: "alice", name: "alice", balance: 2 }),
  });
  await settle();
  assert(ui.nodes.get("#person-name").textContent !== "alice");
});

Deno.test("camera failures expose a retry control", async () => {
  const ui = await setup({ cameraFailure: true });
  assert(!ui.nodes.get("#camera-start").hidden);
  assert(!ui.nodes.get("#camera-start").disabled);
  assert(ui.nodes.get("#camera-error").textContent === "Camera unavailable");
});
