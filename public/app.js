import { config } from "./config.js";

const apiBase = config.apiBaseUrl.replace(/\/$/, "");
const storageKey = `credit-cards:staff:${apiBase || location.origin}`;
let sessionToken;
try {
  sessionToken = localStorage.getItem(storageKey);
} catch { /* Memory-only session if browser storage is disabled. */ }
function saveToken(token) {
  sessionToken = token;
  try {
    if (token) localStorage.setItem(storageKey, token);
    else localStorage.removeItem(storageKey);
  } catch { /* Continue for this tab. */ }
}
const route = () => new URL(location.hash.slice(1) || "/", location.origin);
const apiUrl = (path) => `${apiBase}${path}`;
const pendingChanges = new Map();
let pageVersion = 0;
let camera;
const app = document.querySelector("#app");
const message = document.querySelector("#message");
const printArea = document.querySelector("#print-cards");
let accounts = [];
let activeAccount;
let busy = false;
let pendingChange;
let noticeTimer;
let authenticated = false;

function renderStaffNav() {
  let nav = document.querySelector("#staff-nav");
  if (!nav) {
    nav = element("div", "staff-nav");
    nav.id = "staff-nav";
    document.querySelector(".topbar").append(nav);
  }
  nav.replaceChildren();
  if (authenticated) {
    if (route().pathname !== "/scan") {
      const scan = element("a", "button primary", "Scan cards");
      scan.href = "#/scan";
      nav.append(scan);
    }
    const logout = element("button", "text-button", "Staff · Sign out");
    logout.onclick = async () => {
      logout.disabled = true;
      try {
        await api("/api/logout", {});
        saveToken(null);
        authenticated = false;
        renderStaffNav();
        await renderPage();
      } catch (error) {
        notice(error.message, true);
      } finally {
        logout.disabled = false;
      }
    };
    nav.append(logout);
  } else {
    const login = element("a", "button secondary", "Staff sign in");
    login.href = `#/login?returnTo=${
      encodeURIComponent(
        route().pathname === "/login" ? "/" : route().pathname,
      )
    }`;
    nav.append(login);
  }
}

function loginPage() {
  const requested = route().searchParams.get("returnTo");
  const returnTo =
    requested && /^\/(?:scan|account\/[0-9a-f-]{36})?$/i.test(requested)
      ? requested
      : "/";
  if (authenticated) {
    location.replace(`#${returnTo}`);
    return;
  }
  document.title = "Staff sign in · Credit Cards";
  app.innerHTML =
    `<section class="panel login-panel"><p class="eyebrow">STAFF ACCESS</p><h1>Sign in.</h1><p>Enter the staff password to create accounts and adjust credits.</p><form id="login-form"><label for="password">Staff password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required><button class="button primary" type="submit">Sign in</button><p id="login-error" class="inline-error" role="alert"></p></form><a class="back-link" id="viewer-link">Continue as a viewer</a></section>`;
  document.querySelector("#viewer-link").href = `#${returnTo}`;
  document.querySelector("#login-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const error = document.querySelector("#login-error");
      error.textContent = "";
      button.disabled = true;
      try {
        const result = await api("/api/login", {
          password: form.elements.password.value,
        });
        saveToken(result.token);
        authenticated = true;
        renderStaffNav();
        form.reset();
        location.replace(`#${returnTo}`);
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        button.disabled = false;
      }
    },
  );
}

// getRandomValues works on HTTP LAN addresses as well as HTTPS.
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notice(text, error = false) {
  clearTimeout(noticeTimer);
  message.textContent = text;
  message.className = error ? "error" : "success";
  message.hidden = false;
  noticeTimer = setTimeout(() => message.hidden = true, 6000);
}

async function api(path, body) {
  const response = await fetch(
    apiUrl(path),
    {
      cache: "no-store",
      credentials: "omit",
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") {
      authenticated = false;
      saveToken(null);
      renderStaffNav();
      if (activeAccount && document.querySelector("#credit-value")) {
        updateBalance();
      } else setDashboardAccess();
    }
    const error = new Error(result.error || "Unable to complete the request.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function card(account) {
  const node = element("article", "paper-card");
  node.append(
    element("span", "eyebrow", "YOUR CREDIT CARD"),
    element("h2", "card-name", account.name),
  );
  const qr = element("img", "qr");
  qr.src = apiUrl(`/api/accounts/${account.id}/qr`);
  qr.alt = `QR code for ${account.name}'s account`;
  qr.width = qr.height = 220;
  node.append(
    qr,
    element("p", "card-caption", "Scan to view your credits"),
    element("small", "card-link", account.url),
  );
  return node;
}

async function printCards(items) {
  printArea.replaceChildren(...items.map(card));
  try {
    await Promise.all(
      [...printArea.querySelectorAll("img")].map((img) => img.decode()),
    );
    window.print();
  } catch {
    notice("Could not load the QR codes. Please try printing again.", true);
  }
}

async function dashboard() {
  app.innerHTML = `
    <section class="intro"><div><p class="eyebrow">THE CREDIT DESK</p><h1>Good people.<br>A little credit.</h1><p class="lede">One card for each person. One simple way to keep track.</p></div><div class="intro-seal" aria-hidden="true"><span>SCAN</span><b>+1</b><span>AND GO</span></div></section>
    <div class="dashboard-grid"><section class="panel create-panel"><p class="eyebrow">01 / SET SOMEONE UP</p><h2>A name. A starting balance.</h2><p>Create an account, then print their card.</p>
    <form id="create-form"><label for="name">Name</label><input id="name" name="name" placeholder="e.g. Alex Morgan" maxlength="80" required autocomplete="off"><label for="balance">Starting credits</label><input id="balance" name="balance" type="number" min="0" max="1000000" step="1" value="0" required><button class="button primary" type="submit">Create account <span aria-hidden="true">↗</span></button><p id="form-error" class="inline-error" role="alert"></p></form>
    <div class="small-note">Cards link to this website. Their balances stay up to date when credits change.</div></section>
    <section class="panel accounts-panel"><div class="section-heading"><div><p class="eyebrow">02 / READY TO GO</p><h2>Your accounts <span id="count" class="count">0</span></h2></div><button id="print-all" class="button secondary" disabled>Print all cards</button></div><label class="sr-only" for="search">Search accounts</label><input id="search" type="search" placeholder="Find a person…"><div id="account-list" aria-live="polite"><p class="muted">Loading accounts…</p></div></section></div>
    <p class="access-note">Anyone can view balances. Signed-in staff can create accounts and change credits.</p>`;
  setDashboardAccess();
  document.querySelector("#search").addEventListener("input", renderList);
  document.querySelector("#print-all").addEventListener(
    "click",
    () => printCards(accounts),
  );
  document.querySelector("#create-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      const error = document.querySelector("#form-error");
      button.disabled = true;
      error.textContent = "";
      try {
        const account = await api("/api/accounts", {
          name: form.elements.name.value,
          balance: Number(form.elements.balance.value),
        });
        accounts.push(account);
        accounts.sort((a, b) => a.name.localeCompare(b.name));
        form.reset();
        document.querySelector("#search").value = "";
        renderList();
        notice(`${account.name}'s account is ready.`);
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        button.disabled = false;
      }
    },
  );
  await loadAccounts();
}

function setDashboardAccess() {
  const panel = document.querySelector(".create-panel");
  if (!panel) return;
  panel.hidden = !authenticated;
  document.querySelector("#print-all").hidden = !authenticated;
  document.querySelector(".dashboard-grid").classList.toggle(
    "viewer",
    !authenticated,
  );
}

async function loadAccounts() {
  if (!document.querySelector("#account-list")) return;
  const version = pageVersion;
  try {
    const result = await api("/api/accounts");
    if (version !== pageVersion) return;
    accounts = result.accounts;
    renderList();
  } catch (error) {
    if (version !== pageVersion) return;
    const list = document.querySelector("#account-list");
    list.replaceChildren(element("p", "inline-error", error.message));
    const retry = element("button", "button secondary", "Try again");
    retry.onclick = loadAccounts;
    list.append(retry);
  }
}

function renderList() {
  document.querySelector("#count").textContent = accounts.length;
  document.querySelector("#print-all").disabled = accounts.length === 0;
  const query = document.querySelector("#search").value.toLowerCase();
  const filtered = accounts.filter((a) => a.name.toLowerCase().includes(query));
  const list = document.querySelector("#account-list");
  list.replaceChildren();
  if (!filtered.length) {
    list.append(
      element(
        "div",
        "empty-state",
        accounts.length
          ? "No matching accounts."
          : "Your first card starts here. Add someone to get going.",
      ),
    );
    return;
  }
  for (const account of filtered) {
    const row = element("article", "account-row");
    const avatar = element(
      "span",
      "avatar",
      account.name.slice(0, 1).toUpperCase(),
    );
    avatar.setAttribute("aria-hidden", "true");
    const link = element("a", "account-name", account.name);
    link.href = `#/account/${account.id}`;
    const balance = element(
      "span",
      "balance-pill",
      `${account.balance.toLocaleString()} ${
        account.balance === 1 ? "credit" : "credits"
      }`,
    );
    const print = element("button", "text-button", "Print card");
    print.onclick = () => printCards([account]);
    row.append(avatar, link, balance);
    if (authenticated) row.append(print);
    list.append(row);
  }
}

async function accountPage(id) {
  const version = pageVersion;
  try {
    const account = await api(`/api/accounts/${id}`);
    if (version !== pageVersion) return;
    activeAccount = account;
    pendingChange = pendingChanges.get(id);
    renderAccount();
  } catch (error) {
    if (version !== pageVersion) return;
    app.replaceChildren(
      element(
        "h1",
        "error-title",
        error.status === 404 ? "Card not found." : "Couldn’t load this card.",
      ),
      element("p", "lede", error.message),
    );
    const retry = element("button", "button primary", "Try again");
    retry.onclick = () => accountPage(id);
    const home = element("a", "back-link", "Back to accounts");
    home.href = "#/";
    app.append(retry, home);
  }
}

function renderAccount() {
  app.innerHTML =
    `<a class="back-link" href="#/">← All accounts</a><div class="account-layout"><section class="balance-panel"><p class="eyebrow">YOU’RE LOOKING AT</p><h1 id="person-name"></h1><p class="muted">Available credits</p><p id="credit-value" class="credit-value" aria-live="polite"></p><div class="credit-actions"><button id="remove" class="button secondary">− Remove 1</button><button id="add" class="button primary">+ Add 1</button></div><p id="change-status" class="change-status" role="status"></p><button id="refresh" class="text-button">Refresh balance</button></section><aside class="card-preview"><div id="single-card"></div><button id="print-one" class="button secondary">Print this card</button></aside></div><p class="access-note">Anyone with this card link can view the balance. Only signed-in staff can change credits.</p>`;
  document.querySelector("#person-name").textContent = activeAccount.name;
  document.title = `${activeAccount.name} · Credit Cards`;
  document.querySelector("#single-card").append(card(activeAccount));
  document.querySelector("#print-one").onclick = () =>
    printCards([activeAccount]);
  document.querySelector("#add").onclick = () => changeCredit(1);
  document.querySelector("#remove").onclick = () => changeCredit(-1);
  document.querySelector("#refresh").onclick = refreshBalance;
  updateBalance();
}

function updateBalance() {
  document.querySelector(".credit-actions").hidden = !authenticated;
  const print = document.querySelector("#print-one");
  if (print) print.hidden = !authenticated;
  document.querySelector("#credit-value").textContent = activeAccount.balance
    .toLocaleString();
  document.querySelector("#add").disabled = !authenticated || busy ||
    Boolean(pendingChange && pendingChange.delta !== 1) ||
    (activeAccount.balance >= 1000000 && !pendingChange);
  document.querySelector("#remove").disabled = !authenticated || busy ||
    Boolean(pendingChange && pendingChange.delta !== -1) ||
    (activeAccount.balance === 0 && !pendingChange);
  document.querySelector("#refresh").disabled = busy;
  const next = document.querySelector("#scan-next");
  if (next) next.disabled = busy || Boolean(pendingChange);
}

async function changeCredit(delta) {
  if (busy || !authenticated) return;
  busy = true;
  pendingChange ??= { delta, requestId: requestId() };
  const accountId = activeAccount.id;
  const operation = pendingChange;
  pendingChanges.set(accountId, operation);
  updateBalance();
  const status = document.querySelector("#change-status");
  status.textContent = "Saving…";
  try {
    const updated = await api(
      `/api/accounts/${accountId}/credits`,
      operation,
    );
    pendingChanges.delete(accountId);
    if (activeAccount?.id === accountId) {
      activeAccount = updated;
      pendingChange = undefined;
    }
    status.textContent = delta === 1
      ? "One credit added."
      : "One credit removed.";
  } catch (error) {
    // Keep the same request ID after network failures so a retry cannot double-charge.
    if (error.status && error.status < 500) pendingChanges.delete(accountId);
    if (activeAccount?.id === accountId) {
      pendingChange = pendingChanges.get(accountId);
    }
    status.textContent = pendingChanges.has(accountId)
      ? "Couldn’t confirm the change. Press the same button to retry safely."
      : error.message;
    if (!pendingChanges.has(accountId) && activeAccount?.id === accountId) {
      await refreshBalance();
    }
  } finally {
    busy = false;
    if (activeAccount && document.querySelector("#credit-value")) {
      updateBalance();
    }
  }
}

async function refreshBalance() {
  const id = activeAccount?.id;
  if (!id) return;
  try {
    const updated = await api(`/api/accounts/${id}`);
    if (activeAccount?.id !== id || !document.querySelector("#credit-value")) {
      return;
    }
    activeAccount = updated;
    updateBalance();
  } catch (error) {
    notice(error.message, true);
  }
}

async function scannerPage() {
  if (!authenticated) {
    location.replace("#/login?returnTo=%2Fscan");
    return;
  }
  const version = pageVersion;
  document.title = "Scan cards · Credit Cards";
  app.innerHTML =
    `<section class="scanner-intro"><p class="eyebrow">THE QUICK CREDIT DESK</p><h1>Scan. Credit. Next.</h1><p class="lede">Keep the camera open and work through cards here.</p></section><div class="scanner-layout"><section class="panel camera-panel"><div class="camera-frame"><video id="camera-video" autoplay muted playsinline aria-label="Live card scanner"></video><div class="camera-guide" aria-hidden="true"></div></div><p id="camera-status" role="status">Start the camera, then hold a card inside the frame.</p><div class="camera-buttons"><button id="camera-start" class="button primary">Start camera</button><button id="camera-stop" class="button secondary" hidden>Stop camera</button><button id="scan-next" class="button primary" hidden>Scan next card</button></div><p id="camera-error" class="inline-error" role="alert"></p></section><section id="scan-result" class="panel scan-result" aria-live="polite"><p class="empty-state">The person’s name and balance will appear here.</p></section></div>`;
  const video = document.querySelector("#camera-video");
  const status = document.querySelector("#camera-status");
  const error = document.querySelector("#camera-error");
  const start = document.querySelector("#camera-start");
  const stop = document.querySelector("#camera-stop");
  const next = document.querySelector("#scan-next");
  const result = document.querySelector("#scan-result");
  let lastInvalidNotice = 0;
  let acceptingCard = false;
  const showCameraError = (text) => {
    error.textContent = text;
    start.hidden = false;
    start.disabled = false;
    stop.hidden = true;
    camera = undefined;
    status.textContent = "Camera is off.";
  };
  start.onclick = async () => {
    start.disabled = true;
    error.textContent = "";
    status.textContent = "Opening camera…";
    try {
      const { startScanner, cardIdFromCode } = await import("./scanner.js");
      if (version !== pageVersion) return;
      const controller = await startScanner(video, (code) => {
        if (acceptingCard || activeAccount) return true;
        const id = cardIdFromCode(code);
        if (!id) {
          if (Date.now() - lastInvalidNotice > 3000) {
            error.textContent = "That QR code is not an account card.";
            lastInvalidNotice = Date.now();
          }
          return false;
        }
        acceptingCard = true;
        error.textContent = "";
        status.textContent = "Card found. Loading account…";
        next.hidden = false;
        next.disabled = true;
        result.replaceChildren(element("p", "loading", "Loading account…"));
        (async () => {
          try {
            const account = await api(`/api/accounts/${id}`);
            if (version !== pageVersion) return;
            activeAccount = account;
            pendingChange = pendingChanges.get(id);
            result.innerHTML =
              `<section class="balance-panel"><p class="eyebrow">CARD FOUND</p><h2 id="person-name"></h2><p class="muted">Available credits</p><p id="credit-value" class="credit-value" aria-live="polite"></p><div class="credit-actions"><button id="remove" class="button secondary">− Remove 1</button><button id="add" class="button primary">+ Add 1</button></div><p id="change-status" class="change-status" role="status"></p><button id="refresh" class="text-button">Refresh balance</button></section>`;
            document.querySelector("#person-name").textContent = account.name;
            document.querySelector("#add").onclick = () => changeCredit(1);
            document.querySelector("#remove").onclick = () => changeCredit(-1);
            document.querySelector("#refresh").onclick = refreshBalance;
            result.append(next);
            updateBalance();
            status.textContent = "Adjust the credits, then scan the next card.";
            result.scrollIntoView({ behavior: "smooth", block: "nearest" });
          } catch (failure) {
            if (version !== pageVersion) return;
            result.replaceChildren(
              element("p", "inline-error", failure.message),
            );
            next.disabled = false;
            result.append(next);
            status.textContent = "Scan another card to continue.";
          } finally {
            acceptingCard = false;
          }
        })();
        return true;
      }, showCameraError);
      if (version !== pageVersion) {
        controller.stop();
        return;
      }
      camera = controller;
      start.hidden = true;
      start.disabled = false;
      stop.hidden = false;
      status.textContent = activeAccount
        ? "Adjust the credits, then scan the next card."
        : "Point the camera at a card’s QR code.";
    } catch (failure) {
      if (version !== pageVersion) return;
      showCameraError(
        failure.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera access for this website in your browser settings, then try again."
          : failure.name === "NotFoundError"
          ? "No camera was found on this device."
          : failure.message,
      );
    }
  };
  stop.onclick = () => {
    camera?.stop();
    camera = undefined;
    start.hidden = false;
    stop.hidden = true;
    status.textContent =
      "Camera is off. You can still update the account shown here.";
  };
  next.onclick = () => {
    if (busy || pendingChange || acceptingCard) return;
    activeAccount = undefined;
    result.replaceChildren(
      element("p", "empty-state", "Hold the next card inside the frame."),
    );
    document.querySelector(".camera-buttons").append(next);
    next.hidden = true;
    error.textContent = "";
    status.textContent = camera
      ? "Point the camera at the next card."
      : "Start the camera to scan the next card.";
    camera?.resume();
    video.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
}

async function renderPage() {
  camera?.stop();
  camera = undefined;
  pageVersion++;
  activeAccount = undefined;
  pendingChange = undefined;
  app.replaceChildren(element("p", "loading", "Loading…"));
  const match = route().pathname.match(/^\/account\/([0-9a-f-]{36})$/i);
  renderStaffNav();
  if (route().pathname === "/login") loginPage();
  else if (route().pathname === "/scan") await scannerPage();
  else if (match) await accountPage(match[1]);
  else await dashboard();
}

window.addEventListener("hashchange", renderPage);
window.addEventListener("pagehide", () => camera?.stop());
window.addEventListener("storage", async (event) => {
  if (event.key !== storageKey) return;
  sessionToken = event.newValue;
  try {
    ({ authenticated } = await api("/api/session"));
    await renderPage();
  } catch {
    notice("Could not refresh staff access. Try signing in again.", true);
  }
});

try {
  ({ authenticated } = await api("/api/session"));
  if (!authenticated) saveToken(null);
} catch {
  notice("Could not check staff session. Showing read-only access.", true);
}
renderStaffNav();
await renderPage();

document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && !busy && !pendingChange) {
    try {
      const session = await api("/api/session");
      if (session.authenticated !== authenticated) {
        authenticated = session.authenticated;
        renderStaffNav();
        await renderPage();
      } else if (activeAccount) await refreshBalance();
      else if (!["/login", "/scan"].includes(route().pathname)) {
        await loadAccounts();
      }
    } catch (error) {
      notice(error.message, true);
    }
  }
});
