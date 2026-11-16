import { shell } from "web/views/shell.tsx";
import { browserStorage, query } from "web/dom.ts";
import { asError, type Session } from "web/types.ts";
import { AccountCache } from "web/account-cache.ts";
import { ApiClient } from "web/api-client.ts";
import { DashboardPage } from "web/dashboard-page.tsx";
import { CardPrinting } from "web/card-printing.ts";
import { AccountPages } from "web/account-pages.tsx";
import { StaffSession } from "web/staff-session.tsx";
import { ScannerPage } from "web/scanner-page.ts";
import { ScannerFullscreen } from "web/scanner-fullscreen.ts";
import { SyncDialog } from "web/sync-dialog.ts";

class Application {
  private readonly app: HTMLElement;
  private readonly message: HTMLElement;
  private pageVersion = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly client: ApiClient;
  private readonly accountCache: AccountCache;
  private readonly syncDialog: SyncDialog;
  private readonly fullscreen: ScannerFullscreen;
  private readonly printing: CardPrinting;
  private readonly accounts: AccountPages;
  private readonly dashboard: DashboardPage;
  private readonly staff: StaffSession;
  private readonly scanner: ScannerPage;

  constructor() {
    document.body.replaceChildren(...shell());
    this.app = query("#app");
    this.message = query("#message");
    this.client = new ApiClient(() => {
      this.staff.authenticated = false;
      this.staff.renderNav();
      this.accounts.updateAccess();
      this.dashboard.updateAccess();
    });
    this.accountCache = new AccountCache({
      api: this.client.api,
      cacheStorage: browserStorage("localStorage"),
      queueStorage: browserStorage("sessionStorage"),
      key: `credit-cards:accounts:${
        this.client.apiBase.length > 0 ? this.client.apiBase : location.origin
      }`,
      onChange: () => {
        this.accounts.refreshCached();
        this.dashboard.refreshCached();
        this.scanner.refresh();
      },
      onError: (error) =>
        this.syncDialog.show(error, () => this.accountCache.retry()),
    });
    this.syncDialog = new SyncDialog(
      this.accountCache,
      () => this.accounts.checkAllAccounts(),
    );
    this.fullscreen = new ScannerFullscreen(this.route);
    this.printing = new CardPrinting(this.client.apiUrl, this.notice);
    this.accounts = new AccountPages({
      card: this.printing.card,
      printCards: this.printing.printCards,
      accountCache: this.accountCache,
      isAuthenticated: () => this.staff.authenticated,
      getPageVersion: () => this.pageVersion,
      syncFailure: this.syncDialog.show,
    });
    this.dashboard = new DashboardPage({
      api: this.client.api,
      accountCache: this.accountCache,
      isAuthenticated: () => this.staff.authenticated,
      notice: this.notice,
      printCards: this.printing.printCards,
      checkAllAccounts: this.accounts.checkAllAccounts,
    });
    this.staff = new StaffSession({
      api: this.client.api,
      saveToken: this.client.saveToken,
      route: this.route,
      accountCache: this.accountCache,
      enterScannerFullscreen: this.fullscreen.enter,
      onNavigate: this.renderPage,
      notice: this.notice,
    });
    this.scanner = new ScannerPage({
      accountCache: this.accountCache,
      accounts: this.accounts,
      isAuthenticated: () => this.staff.authenticated,
      getPageVersion: () => this.pageVersion,
      enterScannerFullscreen: this.fullscreen.enter,
      updateFullscreenControl: this.fullscreen.update,
      syncFailure: this.syncDialog.show,
    });
  }

  private readonly route = () => {
    const path = location.hash.slice(1);
    return new URL(path.length > 0 ? path : "/", location.origin);
  };

  private readonly notice = (text: string, error = false) => {
    clearTimeout(this.noticeTimer);
    this.message.textContent = text;
    this.message.className = error ? "error" : "success";
    this.message.hidden = false;
    this.noticeTimer = setTimeout(() => this.message.hidden = true, 6000);
  };

  private readonly renderPage = async () => {
    this.scanner.dispose();
    const path = this.route().pathname;
    if (path !== "/scan") void this.fullscreen.leave();
    document.body.classList.remove("scanning");
    this.pageVersion++;
    this.accounts.activeAccount = undefined;
    this.app.replaceChildren(<p className="loading">Loading…</p>);
    const match = path.match(/^\/account\/([0-9a-f-]{36})$/i);
    this.staff.renderNav();
    if (path === "/login") this.staff.loginPage();
    else if (path === "/scan") await this.scanner.render();
    else if (match !== null) await this.accounts.accountPage(match[1]);
    else await this.dashboard.render();
  };

  private readonly onStorage = async (event: StorageEvent) => {
    if (event.key !== this.client.storageKey) return;
    this.client.acceptStoredToken(event.newValue);
    try {
      this.staff.authenticated =
        (await this.client.api<Session>("/api/session")).authenticated;
      await this.renderPage();
    } catch {
      this.notice(
        "Could not refresh staff access. Try signing in again.",
        true,
      );
    }
  };

  private readonly onOnline = () => {
    if (this.staff.authenticated && !this.accountCache.failed) {
      void this.accountCache.drain();
    }
  };

  private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (this.accountCache.queue.length > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
  };

  private readonly onPageHide = () => this.scanner.stopCamera();

  private readonly onVisibilityChange = async () => {
    if (document.hidden) return;
    try {
      const session = await this.client.api<Session>("/api/session");
      if (session.authenticated !== this.staff.authenticated) {
        this.staff.authenticated = session.authenticated;
        this.staff.renderNav();
        await this.renderPage();
      } else if (this.route().pathname === "/scan") {
        await this.accounts.checkAllAccounts();
      } else if (this.accounts.activeAccount !== undefined) {
        await this.accounts.refreshBalance();
      } else if (!["/login", "/scan"].includes(this.route().pathname)) {
        await this.dashboard.loadAccounts();
      }
    } catch (caught) {
      this.notice(asError(caught).message, true);
    }
  };

  async start() {
    addEventListener("hashchange", this.renderPage);
    addEventListener("pagehide", this.onPageHide);
    addEventListener("storage", this.onStorage);
    try {
      this.staff.authenticated =
        (await this.client.api<Session>("/api/session")).authenticated;
      if (!this.staff.authenticated) this.client.saveToken(null);
    } catch {
      this.notice(
        "Could not check staff session. Showing read-only access.",
        true,
      );
    }
    addEventListener("online", this.onOnline);
    addEventListener("beforeunload", this.onBeforeUnload);
    this.staff.renderNav();
    await this.renderPage();
    if (this.staff.authenticated) void this.accountCache.drain();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }
}

await new Application().start();
