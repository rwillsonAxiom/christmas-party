import { LoginElement } from "web/views/login.tsx";
import { optional, query } from "web/dom.ts";
import { type Api, asError, type LoginResponse } from "web/types.ts";
import type { AccountCache } from "web/account-cache.ts";
type Options = {
  api: Api;
  saveToken: (token: string | null) => void;
  route: () => URL;
  accountCache: AccountCache;
  enterScannerFullscreen: () => Promise<void>;
  onNavigate: () => Promise<void>;
  notice: (text: string, error?: boolean) => void;
};
export class StaffSession {
  private readonly app = query("#app");
  authenticated = false;
  constructor(private readonly options: Options) {}
  readonly renderNav = () => {
    let nav = optional<HTMLDivElement>("#staff-nav");
    if (nav === null) {
      nav = <div id="staff-nav" className="staff-nav" /> as HTMLDivElement;
      query<HTMLElement>(".topbar").append(nav);
    }
    nav.replaceChildren();
    if (this.authenticated) {
      if (this.options.route().pathname !== "/scan") {
        const scan = <a className="button primary" href="#/scan">Scan cards</a>;
        scan.onclick = (event) => {
          if (
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
          ) {
            return;
          }
          event.preventDefault();
          location.hash = "#/scan";
          // Fullscreen must be requested in the tap handler, before any awaits.
          void this.options.enterScannerFullscreen();
        };
        nav.append(scan);
      }
      const logout = (
        <button type="button" className="text-button">Staff · Sign out</button>
      ) as HTMLButtonElement;
      logout.onclick = async () => {
        logout.disabled = true;
        try {
          await this.options.api("/api/logout", {});
          this.options.saveToken(null);
          this.authenticated = false;
          this.renderNav();
          await this.options.onNavigate();
        } catch (caught) {
          const error = asError(caught);
          this.options.notice(error.message, true);
        } finally {
          logout.disabled = false;
        }
      };
      nav.append(logout);
    } else {
      const returnTo = this.options.route().pathname === "/login"
        ? "/"
        : this.options.route().pathname;
      const login = (
        <a
          className="button secondary"
          href={`#/login?returnTo=${encodeURIComponent(returnTo)}`}
        >
          Staff sign in
        </a>
      );
      nav.append(login);
    }
  };

  readonly loginPage = () => {
    const requested = this.options.route().searchParams.get("returnTo");
    const returnTo = requested !== null &&
        /^\/(?:scan|account\/[0-9a-f-]{36})?$/i.test(requested)
      ? requested
      : "/";
    if (this.authenticated) {
      location.replace(`#${returnTo}`);
      return;
    }
    document.title = "Staff sign in · Credit Cards";
    const login = new LoginElement();
    login.returnTo = returnTo;
    login.signIn = async (password) => {
      const result = await this.options.api<LoginResponse>("/api/login", {
        password,
      });
      this.options.saveToken(result.token);
      this.authenticated = true;
      void this.options.accountCache.retry();
      this.renderNav();
      location.replace(`#${returnTo}`);
    };
    this.app.replaceChildren(login);
  };
}
