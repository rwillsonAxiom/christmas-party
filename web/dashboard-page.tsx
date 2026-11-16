import { dashboard } from "web/views/dashboard.tsx";
import { AccountRowElement } from "web/views/account-row.tsx";
import { optional, query } from "web/dom.ts";
import { type Account, type Api, asError } from "web/types.ts";
import type { AccountCache } from "web/account-cache.ts";
type Options = {
  api: Api;
  accountCache: AccountCache;
  isAuthenticated: () => boolean;
  notice: (text: string, error?: boolean) => void;
  printCards: (items: Account[]) => Promise<void>;
  checkAllAccounts: () => Promise<void>;
};
export class DashboardPage {
  private readonly app = query("#app");
  private accounts: Account[] = [];
  constructor(private readonly options: Options) {}
  readonly render = async () => {
    this.app.replaceChildren(...dashboard());
    this.updateAccess();
    query<HTMLInputElement>("#search").addEventListener(
      "input",
      this.renderList,
    );
    query<HTMLButtonElement>("#print-all").addEventListener(
      "click",
      () => this.options.printCards(this.accounts),
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
          const account = await this.options.api("/api/accounts", {
            name: (form.elements.namedItem("name") as HTMLInputElement).value,
            balance: Number(
              (form.elements.namedItem("balance") as HTMLInputElement).value,
            ),
          });
          this.options.accountCache.remember(account);
          this.options.accountCache.persist();
          this.accounts = this.options.accountCache.list();
          form.reset();
          query<HTMLInputElement>("#search").value = "";
          this.renderList();
          this.options.notice(`${account.name}'s account is ready.`);
        } catch (caught) {
          const failure = asError(caught);
          error.textContent = failure.message;
        } finally {
          button.disabled = false;
        }
      },
    );
    await this.loadAccounts();
  };

  readonly updateAccess = () => {
    const panel = optional<HTMLElement>(".create-panel");
    if (panel === null) return;
    panel.hidden = !this.options.isAuthenticated();
    query<HTMLButtonElement>("#print-all").hidden = !this.options
      .isAuthenticated();
    query<HTMLElement>(".dashboard-grid").classList.toggle(
      "viewer",
      !this.options.isAuthenticated(),
    );
  };

  readonly loadAccounts = async () => {
    this.accounts = this.options.accountCache.list();
    this.renderList();
    await this.options.checkAllAccounts();
  };

  private readonly renderList = () => {
    query<HTMLElement>("#count").textContent = String(this.accounts.length);
    query<HTMLButtonElement>("#print-all").disabled =
      this.accounts.length === 0;
    const searchQuery = query<HTMLInputElement>("#search").value.toLowerCase();
    const filtered = this.accounts.filter((a) =>
      a.name.toLowerCase().includes(searchQuery)
    );
    const list = query<HTMLElement>("#account-list");
    list.replaceChildren();
    if (filtered.length === 0) {
      list.append(
        <div className="empty-state">
          {this.accounts.length > 0
            ? "No matching accounts."
            : "Your first card starts here. Add someone to get going."}
        </div>,
      );
      return;
    }
    for (const account of filtered) {
      list.append(
        new AccountRowElement().configure(
          account,
          this.options.isAuthenticated(),
          () => this.options.printCards([account]),
        ),
      );
    }
  };

  refreshCached() {
    this.accounts = this.options.accountCache.list();
    if (optional("#account-list") !== null) this.renderList();
  }
}
