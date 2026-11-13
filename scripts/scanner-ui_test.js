// Exercise the generated browser bundle, including the real JSX runtime.
// Camera hardware and layout still need an HTTPS phone check.
const source = (await Deno.readTextFile(
  new URL("../public/app.js", import.meta.url),
)).replace("await loadScanner()", "await testScanner()");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function assert(value, message = "Assertion failed") {
  if (!value) throw new Error(message);
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function setup(
  {
    cameraFailure = false,
    cached = true,
    fullscreen = false,
    fullscreenFailure = false,
    initialHash = "#/scan",
    staff = true,
    personName = "alice",
  } = {},
) {
  const nodes = new Map();
  function node(tag = "div") {
    const classes = new Set();
    const attributes = new Map();
    const result = {
      tagName: tag.toUpperCase(),
      children: [],
      value: "",
      hidden: false,
      disabled: false,
      get className() {
        return [...classes].join(" ");
      },
      set className(value) {
        classes.clear();
        value.split(" ").filter(Boolean).forEach((x) => classes.add(x));
      },
      get textContent() {
        return this.children.map((x) =>
          typeof x === "string" ? x : x.textContent
        ).join("");
      },
      set textContent(value) {
        this.replaceChildren(String(value));
      },
      set id(value) {
        attributes.set("id", value);
        nodes.set(`#${value}`, this);
      },
      get id() {
        return attributes.get("id");
      },
      classList: {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        contains: (value) => classes.has(value),
        toggle: (value, force) =>
          force ? classes.add(value) : classes.delete(value),
      },
      setAttribute(key, value) {
        attributes.set(key, String(value));
        if (key === "id") this.id = value;
        else if (key === "class") this.className = value;
        else if (key === "value") this.value = String(value);
      },
      getAttribute(key) {
        return attributes.get(key);
      },
      toggleAttribute(key, value) {
        if (value) attributes.set(key, "");
        else attributes.delete(key);
        if (key === "hidden" || key === "disabled") this[key] = value;
      },
      open: false,
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      addEventListener(name, callback) {
        this[`on${name}`] = callback;
      },
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      querySelector(selector) {
        return walk(this, selector);
      },
      querySelectorAll(selector) {
        const matches = [];
        const visit = (item) => {
          for (const child of item.children || []) {
            if (typeof child === "string") continue;
            if (matchesSelector(child, selector)) matches.push(child);
            visit(child);
          }
        };
        visit(this);
        return matches;
      },
    };
    return result;
  }
  function matchesSelector(item, selector) {
    if (selector.startsWith("#")) return item.id === selector.slice(1);
    if (selector.startsWith(".")) {
      return item.classList.contains(selector.slice(1));
    }
    return item.tagName === selector.toUpperCase();
  }
  function walk(root, selector) {
    for (const child of root.children || []) {
      if (typeof child === "string") continue;
      if (matchesSelector(child, selector)) return child;
      const found = walk(child, selector);
      if (found) return found;
    }
    return null;
  }
  const document = {
    body: node("body"),
    querySelector: (selector) => walk(document.body, selector),
    createElement: node,
    addEventListener() {},
    fullscreenEnabled: fullscreen,
    fullscreenElement: null,
    documentElement: {
      async requestFullscreen(options) {
        assert(options.navigationUI === "hide");
        if (fullscreenFailure) throw new Error("Fullscreen denied");
        document.fullscreenElement = this;
      },
    },
    async exitFullscreen() {
      this.fullscreenElement = null;
    },
  };
  const events = new Map();
  const window = {
    addEventListener: (name, callback) => events.set(name, callback),
  };
  const location = {
    hash: initialHash,
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
    if (url.endsWith("/session")) result = { authenticated: staff };
    else if (url === "/api/accounts") {
      result = {
        accounts: Object.entries(balances).map(([id, balance]) => ({
          id,
          name: id === "alice" ? personName : id,
          balance,
        })),
      };
    } else if (url.endsWith("/credits")) {
      const id = url.split("/").at(-2);
      if (creditResult) return await creditResult;
      balances[id] += JSON.parse(options.body).delta;
      result = {
        id,
        name: id === "bob" ? "bob" : personName,
        balance: balances[id] ?? 2,
        url: `https://example.test/#/account/${id}`,
      };
    } else {
      if (accountResult) return await accountResult;
      const id = url.split("/").at(-1);
      result = {
        id,
        name: id === "bob" ? "bob" : personName,
        balance: balances[id] ?? 2,
        url: `https://example.test/#/account/${id}`,
      };
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
  let now = 1000;
  const timers = new Map();
  let nextTimer = 0;
  const store = new Map();
  if (cached) {
    store.set(
      "credit-cards:accounts:https://example.test",
      JSON.stringify([
        { id: "alice", name: "alice", balance: 2 },
        { id: "bob", name: "bob", balance: 0 },
      ]),
    );
  }
  const storage = {
    getItem: (key) => store.get(key),
    setItem: (key, value) => store.set(key, value),
  };
  await new AsyncFunction(
    "document",
    "window",
    "location",
    "localStorage",
    "fetch",
    "testScanner",
    "globalThis",
    "Date",
    "setTimeout",
    "clearTimeout",
    source,
  )(
    document,
    window,
    location,
    { getItem: () => "staff", setItem() {}, removeItem() {} },
    fetch,
    scanner,
    { localStorage: storage, sessionStorage: storage },
    class extends Date {
      static now() {
        return now;
      }
    },
    (callback) => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    (id) => timers.delete(id),
  );
  return {
    nodes,
    requests,
    document,
    location,
    navigate: async (hash) => {
      location.hash = hash;
      await events.get("hashchange")();
    },
    detect: (code) => detect(code),
    advance: () => {
      now += 500;
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
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

Deno.test("cached scans and credit changes are instant while the server is delayed", async () => {
  const ui = await setup();
  let finishRead;
  ui.setAccountResult(new Promise((resolve) => finishRead = resolve));
  ui.detect("alice");
  assert(
    ui.nodes.get("#person-name").textContent === "alice",
    "Render before the network responds",
  );
  assert(ui.nodes.get("#credit-value").textContent === "2");
  assert(ui.nodes.get("#add").disabled, "A new card has a short cooldown");
  ui.nodes.get("#add").onclick();
  assert(!ui.requests.some(({ options }) => options.method === "POST"));
  ui.advance();
  assert(!ui.nodes.get("#add").disabled);
  let rejectWrite;
  ui.setCreditResult(new Promise((_, reject) => rejectWrite = reject));
  ui.nodes.get("#add").onclick();
  assert(
    ui.nodes.get("#credit-value").textContent === "3",
    "Update before the server responds",
  );
  ui.nodes.get("#add").onclick();
  assert(
    ui.requests.filter(({ options }) => options.method === "POST").length === 1,
    "Cooldown prevents duplicate taps",
  );
  finishRead({
    ok: true,
    json: () => Promise.resolve({ id: "alice", name: "alice", balance: 2 }),
  });
  await settle();
  assert(
    ui.nodes.get("#credit-value").textContent === "3",
    "Stale background reads cannot overwrite the edit",
  );
  ui.detect("bob");
  assert(
    ui.nodes.get("#person-name").textContent === "bob",
    "Can move on before writes finish",
  );
  rejectWrite(new Error("Connection lost"));
  await settle();
  assert(ui.nodes.get("#sync-dialog").open, "Server failures open a popup");
  ui.setCreditResult(
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: "alice", name: "alice", balance: 3 }),
    }),
  );
  await ui.nodes.get("#sync-retry").onclick();
  const writes = ui.requests.filter(({ options }) => options.method === "POST");
  assert(writes.length === 2);
  assert(
    writes[0].options.body === writes[1].options.body,
    "Retry the same receipt",
  );
  assert(
    ui.nodes.get("#person-name").textContent === "bob",
    "Acknowledgement cannot switch people",
  );
});

Deno.test("leaving scanner stops camera and ignores late account loads", async () => {
  const ui = await setup({ cached: false });
  let finish;
  ui.setAccountResult(new Promise((resolve) => finish = resolve));
  ui.detect("unknown");
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

Deno.test("scanner can enter real fullscreen and leaves it on navigation", async () => {
  const ui = await setup({ fullscreen: true });
  const button = ui.nodes.get("#scanner-fullscreen");
  assert(!button.hidden, "Direct scan links need a fullscreen tap");
  await button.onclick();
  assert(
    ui.document.fullscreenElement === ui.document.documentElement,
    "Fullscreen includes the controls and dialogs",
  );
  assert(button.hidden);
  await ui.leave();
  assert(!ui.document.fullscreenElement);
});

Deno.test("unsupported or declined fullscreen preserves the working scanner", async () => {
  const unsupported = await setup();
  assert(unsupported.nodes.get("#scanner-fullscreen").hidden);
  const declined = await setup({ fullscreen: true, fullscreenFailure: true });
  await declined.nodes.get("#scanner-fullscreen").onclick();
  assert(!declined.nodes.get("#scanner-fullscreen").hidden);
  assert(!declined.nodes.get("#sync-dialog").open);
  declined.detect("alice");
  assert(declined.nodes.get("#person-name").textContent === "alice");
});

Deno.test("JSX dashboard keeps names as text and staff controls remain accessible", async () => {
  const name = '<img src=x onerror="alert(1)">';
  const ui = await setup({ initialHash: "#/", personName: name });
  assert(ui.nodes.get("#account-list").textContent.includes(name));
  assert(ui.nodes.get("#account-list").querySelectorAll("img").length === 0);
  assert(
    ui.nodes.get("#create-form").querySelector("label").getAttribute("for") ===
      "name",
  );
  assert(ui.nodes.get("#print-all").disabled === false);
  assert(ui.document.querySelector(".create-panel").hidden === false);
  const viewer = await setup({ initialHash: "#/", staff: false });
  assert(viewer.document.querySelector(".create-panel").hidden);
  assert(viewer.nodes.get("#print-all").hidden);
  assert(!viewer.nodes.get("#account-list").querySelector("button"));
});

Deno.test("JSX login and account views retain labels, balance controls and printable QR cards", async () => {
  const login = await setup({ initialHash: "#/login", staff: false });
  assert(
    login.nodes.get("#login-form").querySelector("label").getAttribute(
      "for",
    ) === "password",
  );
  const id = "12f04857-96da-44c0-9b01-cab5baaa1122";
  const account = await setup({ initialHash: `#/account/${id}` });
  assert(account.nodes.get("#credit-value").textContent === "2");
  assert(
    account.nodes.get("#single-card").querySelector("img").getAttribute(
      "src",
    ) === `/api/accounts/${id}/qr`,
  );
  assert(!account.nodes.get("#add").disabled);
  await account.navigate("#/scan");
  const video = account.nodes.get("#camera-video");
  assert(video.muted);
  account.detect("alice");
  await settle();
  assert(
    account.nodes.get("#camera-video") === video,
    "Balance checks must retain the live camera element",
  );
});
