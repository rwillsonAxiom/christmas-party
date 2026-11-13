import * as views from "./views.tsx";
import {
  type Account,
  asError,
  type LoginResponse,
  RequestError,
  type Session,
} from "./types.ts";
import { AccountCache } from "./account-cache.ts";
import { cardIdFromCode, type ScannedCode, startScanner } from "./scanner.ts";
import {
  type AccountTarget,
  RecentTargets,
  ScanTargets,
} from "./scan-targets.tsx";

function optional<T extends HTMLElement = HTMLElement>(
  selector: string,
): T | null {
  return document.querySelector<T>(selector);
}
function query<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = optional<T>(selector);
  if (!node) throw new Error(`Missing page element: ${selector}`);
  return node;
}

document.body.replaceChildren(...views.shell());

const apiBase =
  (document.querySelector<HTMLMetaElement>('meta[name="credit-cards-api"]')
    ?.content || "").replace(/\/$/, "");
const storageKey = `credit-cards:staff:${apiBase || location.origin}`;
let sessionToken: string | null = null;
try {
  sessionToken = localStorage.getItem(storageKey);
} catch { /* Memory-only session if browser storage is disabled. */ }
function saveToken(token: string | null) {
  sessionToken = token;
  try {
    if (token) localStorage.setItem(storageKey, token);
    else localStorage.removeItem(storageKey);
  } catch { /* Continue for this tab. */ }
}
const route = () => new URL(location.hash.slice(1) || "/", location.origin);
const apiUrl = (path: string) => `${apiBase}${path}`;
function browserStorage(name: "localStorage" | "sessionStorage") {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
}
const accountCache = new AccountCache({
  api,
  cacheStorage: browserStorage("localStorage"),
  queueStorage: browserStorage("sessionStorage"),
  key: `credit-cards:accounts:${apiBase || location.origin}`,
  onChange: renderCachedAccounts,
  onError: (error) => syncFailure(error, () => accountCache.retry()),
});
const buttonCooldown = 400;
let readyAt = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
let syncRetry: (() => void | Promise<void>) | undefined;
let scannerOwnsFullscreen = false;
function updateFullscreenControl() {
  const button = optional<HTMLButtonElement>("#scanner-fullscreen");
  if (button) {
    button.hidden = !document.fullscreenEnabled ||
      Boolean(document.fullscreenElement);
  }
}
async function enterScannerFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    scannerOwnsFullscreen = true;
    if (route().pathname !== "/scan") await leaveScannerFullscreen();
  } catch {
    /* Keep scanning in the available viewport if the browser declines. */
  }
  updateFullscreenControl();
}
async function leaveScannerFullscreen() {
  if (!scannerOwnsFullscreen) return;
  scannerOwnsFullscreen = false;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* The browser may already have left fullscreen. */ }
}
document.addEventListener("fullscreenchange", updateFullscreenControl);
function cooldown() {
  readyAt = Date.now() + buttonCooldown;
  clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    if (activeAccount && optional<HTMLElement>("#credit-value")) {
      updateBalance();
    }
  }, buttonCooldown);
}
function renderCachedAccounts() {
  accounts = accountCache.list();
  if (activeAccount) {
    activeAccount = accountCache.get(activeAccount.id);
    if (activeAccount && optional<HTMLElement>("#credit-value")) {
      query<HTMLElement>("#person-name").textContent = activeAccount.name;
      updateBalance();
    }
  }
  if (optional<HTMLElement>("#account-list")) renderList();
  renderScanTargets?.();
}
function syncFailure(error: Error, retry: () => void | Promise<void>) {
  syncRetry = accountCache.failed ? () => accountCache.retry() : retry;
  const dialog = query<HTMLDialogElement>("#sync-dialog");
  query<HTMLButtonElement>("#sync-later").hidden = accountCache.failed;
  query<HTMLElement>("#sync-error").textContent = error.message;
  if (!dialog.open) dialog.showModal();
}
async function checkAccount(id: string) {
  try {
    await accountCache.refresh(id);
  } catch (caught) {
    const error = asError(caught);
    syncFailure(error, () => checkAccount(id));
  }
}
async function checkAllAccounts() {
  try {
    await accountCache.refreshAll();
  } catch (caught) {
    const error = asError(caught);
    syncFailure(error, checkAllAccounts);
  }
}
let pageVersion = 0;
let camera:
  | Awaited<ReturnType<typeof import("./scanner.ts").startScanner>>
  | undefined;
const app = query<HTMLElement>("#app");
const message = query<HTMLElement>("#message");
const printArea = query<HTMLElement>("#print-cards");
let accounts: Account[] = [];
let activeAccount: Account | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let authenticated = false;
let renderScanTargets: (() => void) | undefined;
let clearScanTargets: (() => void) | undefined;

function renderStaffNav() {
  let nav = optional<HTMLDivElement>("#staff-nav");
  if (!nav) {
    nav = element("div", "staff-nav") as HTMLDivElement;
    nav.id = "staff-nav";
    query<HTMLElement>(".topbar").append(nav);
  }
  nav.replaceChildren();
  if (authenticated) {
    if (route().pathname !== "/scan") {
      const scan = element(
        "a",
        "button primary",
        "Scan cards",
      ) as HTMLAnchorElement;
      scan.href = "#/scan";
      scan.onclick = (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        location.hash = "#/scan";
        // Fullscreen must be requested in the tap handler, before any awaits.
        void enterScannerFullscreen();
      };
      nav.append(scan);
    }
    const logout = element(
      "button",
      "text-button",
      "Staff · Sign out",
    ) as HTMLButtonElement;
    logout.onclick = async () => {
      logout.disabled = true;
      try {
        await api("/api/logout", {});
        saveToken(null);
        authenticated = false;
        renderStaffNav();
        await renderPage();
      } catch (caught) {
        const error = asError(caught);
        notice(error.message, true);
      } finally {
        logout.disabled = false;
      }
    };
    nav.append(logout);
  } else {
    const login = element(
      "a",
      "button secondary",
      "Staff sign in",
    ) as HTMLAnchorElement;
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
  app.replaceChildren(views.login());
  query<HTMLAnchorElement>("#viewer-link").href = `#${returnTo}`;
  query<HTMLFormElement>("#login-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const button = form.querySelector("button")!;
      const error = query<HTMLElement>("#login-error");
      error.textContent = "";
      button.disabled = true;
      try {
        const result = await api<LoginResponse>("/api/login", {
          password:
            (form.elements.namedItem("password") as HTMLInputElement).value,
        });
        saveToken(result.token);
        authenticated = true;
        void accountCache.retry();
        renderStaffNav();
        form.reset();
        location.replace(`#${returnTo}`);
      } catch (caught) {
        const failure = asError(caught);
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

function element(tag: string, className?: string, text?: string) {
  return views.text(tag, className, text);
}

function notice(text: string, error = false) {
  clearTimeout(noticeTimer);
  message.textContent = text;
  message.className = error ? "error" : "success";
  message.hidden = false;
  noticeTimer = setTimeout(() => message.hidden = true, 6000);
}

async function api<T = Account>(path: string, body?: object): Promise<T> {
  const response = await fetch(
    apiUrl(path),
    {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
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
      if (activeAccount && optional<HTMLElement>("#credit-value")) {
        updateBalance();
      } else setDashboardAccess();
    }
    const error = new RequestError(
      result.error || "Unable to complete the request.",
      response.status,
    );
    throw error;
  }
  return result;
}

function card(account: Account) {
  return views.card(account, apiUrl(`/api/accounts/${account.id}/qr`));
}

async function printCards(items: Account[]) {
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
  app.replaceChildren(...views.dashboard());
  setDashboardAccess();
  query<HTMLInputElement>("#search").addEventListener("input", renderList);
  query<HTMLButtonElement>("#print-all").addEventListener(
    "click",
    () => printCards(accounts),
  );
  query<HTMLFormElement>("#create-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const button = form.querySelector("button")!;
      const error = query<HTMLElement>("#form-error");
      button.disabled = true;
      error.textContent = "";
      try {
        const account = await api("/api/accounts", {
          name: (form.elements.namedItem("name") as HTMLInputElement).value,
          balance: Number(
            (form.elements.namedItem("balance") as HTMLInputElement).value,
          ),
        });
        accountCache.remember(account);
        accountCache.persist();
        accounts = accountCache.list();
        form.reset();
        query<HTMLInputElement>("#search").value = "";
        renderList();
        notice(`${account.name}'s account is ready.`);
      } catch (caught) {
        const failure = asError(caught);
        error.textContent = failure.message;
      } finally {
        button.disabled = false;
      }
    },
  );
  await loadAccounts();
}

function setDashboardAccess() {
  const panel = optional<HTMLElement>(".create-panel");
  if (!panel) return;
  panel.hidden = !authenticated;
  query<HTMLButtonElement>("#print-all").hidden = !authenticated;
  query<HTMLElement>(".dashboard-grid").classList.toggle(
    "viewer",
    !authenticated,
  );
}

async function loadAccounts() {
  accounts = accountCache.list();
  renderList();
  await checkAllAccounts();
}

function renderList() {
  query<HTMLElement>("#count").textContent = String(accounts.length);
  query<HTMLButtonElement>("#print-all").disabled = accounts.length === 0;
  const searchQuery = query<HTMLInputElement>("#search").value.toLowerCase();
  const filtered = accounts.filter((a) =>
    a.name.toLowerCase().includes(searchQuery)
  );
  const list = query<HTMLElement>("#account-list");
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
    list.append(
      views.accountRow(account, authenticated, () => printCards([account])),
    );
  }
}

async function accountPage(id: string) {
  const version = pageVersion;
  const cached = accountCache.get(id);
  if (cached) {
    activeAccount = cached;
    renderAccount();
    void checkAccount(id);
    return;
  }
  try {
    await accountCache.refresh(id);
    if (version !== pageVersion) return;
    activeAccount = accountCache.get(id);
    renderAccount();
  } catch (caught) {
    const error = asError(caught);
    if (version !== pageVersion) return;
    app.replaceChildren(
      element("h1", "error-title", "Could not load this card."),
    );
    syncFailure(error, () => accountPage(id));
  }
}

function renderAccount() {
  if (!activeAccount) return;
  app.replaceChildren(...views.account());
  query<HTMLElement>("#person-name").textContent = activeAccount.name;
  document.title = `${activeAccount.name} · Credit Cards`;
  query<HTMLElement>("#single-card").append(card(activeAccount));
  query<HTMLButtonElement>("#print-one").onclick = () =>
    printCards(activeAccount ? [activeAccount] : []);
  query<HTMLButtonElement>("#add").onclick = () => changeCredit(1);
  query<HTMLButtonElement>("#remove").onclick = () => changeCredit(-1);
  query<HTMLButtonElement>("#refresh").onclick = refreshBalance;
  updateBalance();
}

function updateBalance() {
  if (!activeAccount) return;
  query<HTMLElement>(".credit-actions").hidden = !authenticated;
  const print = optional<HTMLButtonElement>("#print-one");
  if (print) print.hidden = !authenticated;
  query<HTMLElement>("#credit-value").textContent = activeAccount.balance
    .toLocaleString();
  const disabled = !authenticated || accountCache.failed ||
    Date.now() < readyAt;
  query<HTMLButtonElement>("#add").disabled = disabled ||
    activeAccount.balance >= 1000000;
  query<HTMLButtonElement>("#remove").disabled = disabled ||
    activeAccount.balance <= 0;
}

function changeCredit(delta: 1 | -1) {
  if (
    !activeAccount || !authenticated || accountCache.failed ||
    Date.now() < readyAt
  ) return;
  cooldown();
  try {
    accountCache.enqueue(activeAccount.id, delta, requestId());
  } catch (caught) {
    const error = asError(caught);
    updateBalance();
    syncFailure(error, () => accountCache.retry());
  }
}

async function refreshBalance() {
  if (activeAccount) await checkAccount(activeAccount.id);
}

async function loadScanner() {
  return { startScanner, cardIdFromCode };
}

async function scannerPage() {
  if (!authenticated) {
    location.replace("#/login?returnTo=%2Fscan");
    return;
  }
  document.body.classList.add("scanning");
  const version = pageVersion;
  document.title = "Scan cards · Credit Cards";
  app.replaceChildren(views.scanner());
  query<HTMLButtonElement>("#scanner-fullscreen").onclick =
    enterScannerFullscreen;
  updateFullscreenControl();
  const video = query<HTMLVideoElement>("#camera-video");
  video.muted = true;
  const status = query<HTMLElement>("#camera-status");
  const error = query<HTMLElement>("#camera-error");
  const start = query<HTMLButtonElement>("#camera-start");
  const name = query<HTMLElement>("#person-name");
  const balance = query<HTMLElement>("#credit-value");
  let lastInvalidNotice = 0;
  let selectedId: string | undefined;
  let visible: AccountTarget[] = [];
  const recentTargets = new RecentTargets();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const lookups = new Map<string, Promise<void>>();
  const retryAfter = new Map<string, number>();
  const targets = new ScanTargets(query<HTMLElement>("#qr-targets"), (id) => {
    if (visible.some((target) => target.accountId === id)) selectAccount(id);
  });
  const refreshTargets = () => {
    if (version !== pageVersion) return;
    targets.update(visible, selectedId, (id) => accountCache.get(id)?.name);
    if (selectedId && !activeAccount) {
      const account = accountCache.get(selectedId);
      if (account) {
        activeAccount = account;
        name.textContent = account.name;
        updateBalance();
      }
    }
  };
  renderScanTargets = refreshTargets;
  const clearTargets = () => {
    clearTimeout(expiryTimer);
    recentTargets.clear();
    visible = [];
    targets.update([], selectedId, (id) => accountCache.get(id)?.name);
  };
  clearScanTargets = clearTargets;
  const scheduleExpiry = () => {
    clearTimeout(expiryTimer);
    const next = recentTargets.nextExpiry();
    if (next === undefined) return;
    expiryTimer = setTimeout(() => {
      if (version !== pageVersion) return;
      visible = recentTargets.current(Date.now());
      refreshTargets();
      scheduleExpiry();
    }, Math.max(0, next - Date.now()));
  };
  const loadAccount = (id: string): Promise<void> => {
    const pending = lookups.get(id);
    if (pending) return pending;
    if (Date.now() < (retryAfter.get(id) || 0)) return Promise.resolve();
    const task = accountCache.refresh(id).then(() => {}).catch((caught) => {
      if (version !== pageVersion) return;
      retryAfter.set(id, Date.now() + 5000);
      syncFailure(asError(caught), () => {
        retryAfter.delete(id);
        return loadAccount(id);
      });
    }).finally(() => lookups.delete(id));
    lookups.set(id, task);
    return task;
  };
  function selectAccount(id: string) {
    if (
      version !== pageVersion ||
      query<HTMLDialogElement>("#sync-dialog").open || id === selectedId
    ) return;
    selectedId = id;
    cooldown();
    activeAccount = accountCache.get(id);
    if (activeAccount) {
      name.textContent = activeAccount.name;
      updateBalance();
    } else {
      name.textContent = "Loading name…";
      balance.textContent = "\u2014";
      query<HTMLButtonElement>("#add").disabled = true;
      query<HTMLButtonElement>("#remove").disabled = true;
    }
    refreshTargets();
    void loadAccount(id);
    status.textContent =
      "Account selected. Tap another labelled QR code to switch.";
  }
  const onCodes = (codes: ScannedCode[]) => {
    if (version !== pageVersion) return;
    const detected = codes.flatMap((code) => {
      const id = cardIdFromCode(code.value);
      return id ? [{ ...code, accountId: id }] : [];
    });
    recentTargets.observe(detected, Date.now());
    visible = recentTargets.current(Date.now());
    scheduleExpiry();
    error.textContent = "";
    if (
      codes.length && !detected.length && Date.now() - lastInvalidNotice > 3000
    ) {
      error.textContent = "That QR code is not an account card.";
      lastInvalidNotice = Date.now();
    }
    const ids = [...new Set(visible.map((target) => target.accountId))];
    if (ids.length > 1 && !selectedId) {
      selectedId = undefined;
      activeAccount = undefined;
      name.textContent = "Tap a QR code";
      balance.textContent = "\u2014";
      query<HTMLButtonElement>("#add").disabled = true;
      query<HTMLButtonElement>("#remove").disabled = true;
    }
    if (ids.length === 1 && !selectedId) selectAccount(ids[0]);
    for (const id of ids) {
      if (!accountCache.get(id)) void loadAccount(id);
    }
    refreshTargets();
  };
  const showCameraError = (text: string) => {
    if (version !== pageVersion) return;
    clearTargets();
    error.textContent = text;
    start.hidden = false;
    start.disabled = false;
    camera = undefined;
    status.textContent = "Camera is off.";
  };
  const startCamera = async () => {
    start.hidden = true;
    start.disabled = true;
    error.textContent = "";
    status.textContent = "Opening camera…";
    try {
      const { startScanner } = await loadScanner();
      if (version !== pageVersion) return;
      const controller = await startScanner(
        video,
        onCodes,
        showCameraError,
        query<HTMLElement>(".camera-guide"),
      );
      if (version !== pageVersion) {
        controller.stop();
        return;
      }
      camera = {
        stop: () => {
          clearTargets();
          controller.stop();
        },
      };
      start.disabled = false;
      status.textContent = "Point the camera at a card’s QR code.";
    } catch (caught) {
      const failure = asError(caught);
      if (version !== pageVersion) return;
      showCameraError(
        failure.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera access for this website in your browser settings, then retry."
          : failure.name === "NotFoundError"
          ? "No camera was found on this device."
          : failure.message,
      );
    }
  };
  start.onclick = startCamera;
  query<HTMLButtonElement>("#add").onclick = () => changeCredit(1);
  query<HTMLButtonElement>("#remove").onclick = () => changeCredit(-1);
  void checkAllAccounts();
  await startCamera();
}

async function renderPage() {
  clearScanTargets?.();
  clearScanTargets = undefined;
  renderScanTargets = undefined;
  if (route().pathname !== "/scan") void leaveScannerFullscreen();
  document.body.classList.remove("scanning");
  camera?.stop();
  camera = undefined;
  pageVersion++;
  activeAccount = undefined;
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
    ({ authenticated } = await api<Session>("/api/session"));
    await renderPage();
  } catch {
    notice("Could not refresh staff access. Try signing in again.", true);
  }
});

try {
  ({ authenticated } = await api<Session>("/api/session"));
  if (!authenticated) saveToken(null);
} catch {
  notice("Could not check staff session. Showing read-only access.", true);
}
query<HTMLButtonElement>("#sync-retry").onclick = async () => {
  query<HTMLDialogElement>("#sync-dialog").close();
  try {
    await syncRetry?.();
  } catch (caught) {
    const error = asError(caught);
    syncFailure(error, syncRetry || checkAllAccounts);
  }
};
query<HTMLButtonElement>("#sync-later").onclick = () =>
  query<HTMLDialogElement>("#sync-dialog").close();
query<HTMLDialogElement>("#sync-dialog").addEventListener("cancel", (event) => {
  if (accountCache.failed) event.preventDefault();
});
query<HTMLAnchorElement>("#sync-sign-in").onclick = () =>
  query<HTMLDialogElement>("#sync-dialog").close();
window.addEventListener("online", () => {
  if (authenticated && !accountCache.failed) void accountCache.drain();
});
window.addEventListener("beforeunload", (event) => {
  if (accountCache.queue.length) {
    event.preventDefault();
    event.returnValue = "";
  }
});
renderStaffNav();
await renderPage();
if (authenticated) void accountCache.drain();

document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    try {
      const session = await api<Session>("/api/session");
      if (session.authenticated !== authenticated) {
        authenticated = session.authenticated;
        renderStaffNav();
        await renderPage();
      } else if (route().pathname === "/scan") await checkAllAccounts();
      else if (activeAccount) await refreshBalance();
      else if (!["/login", "/scan"].includes(route().pathname)) {
        await loadAccounts();
      }
    } catch (caught) {
      const error = asError(caught);
      notice(error.message, true);
    }
  }
});
