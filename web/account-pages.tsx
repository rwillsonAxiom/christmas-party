import { account } from "web/views/account.tsx";
import { encodeHex } from "@std/encoding/hex";
import { optional, query } from "web/dom.ts";
import { type Account, asError } from "web/types.ts";
import type { AccountCache } from "web/account-cache.ts";
type Options = {
  card: (account: Account) => HTMLElement;
  printCards: (items: Account[]) => Promise<void>;
  accountCache: AccountCache;
  isAuthenticated: () => boolean;
  getPageVersion: () => number;
  syncFailure: (error: Error, retry: () => void | Promise<void>) => void;
};

// Account details and scanning share the active balance and credit-button state.
export class AccountPages {
  private readonly app = query("#app");
  activeAccount: Account | undefined;
  private readonly buttonCooldown = 400;
  private readyAt = 0;
  private cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly options: Options) {}
  readonly cooldown = () => {
    this.readyAt = Date.now() + this.buttonCooldown;
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => {
      if (
        this.activeAccount !== undefined &&
        optional<HTMLElement>("#credit-value") !== null
      ) {
        this.updateBalance();
      }
    }, this.buttonCooldown);
  };

  readonly clearCooldown = () => {
    clearTimeout(this.cooldownTimer);
    this.readyAt = 0;
  };

  readonly refreshCached = () => {
    if (this.activeAccount !== undefined) {
      this.activeAccount = this.options.accountCache.get(this.activeAccount.id);
      if (
        this.activeAccount !== undefined &&
        optional<HTMLElement>("#credit-value") !== null
      ) {
        query<HTMLElement>("#person-name").textContent =
          this.activeAccount.name;
        this.updateBalance();
      }
    }
  };

  readonly checkAccount = async (id: string) => {
    try {
      await this.options.accountCache.refresh(id);
    } catch (caught) {
      const error = asError(caught);
      this.options.syncFailure(error, () => this.checkAccount(id));
    }
  };

  readonly checkAllAccounts = async () => {
    try {
      await this.options.accountCache.refreshAll();
    } catch (caught) {
      const error = asError(caught);
      this.options.syncFailure(error, this.checkAllAccounts);
    }
  };

  private readonly requestId = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = encodeHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
      hex.slice(16, 20)
    }-${hex.slice(20)}`;
  };

  readonly accountPage = async (id: string) => {
    const version = this.options.getPageVersion();
    const cached = this.options.accountCache.get(id);
    if (cached !== undefined) {
      this.activeAccount = cached;
      this.renderAccount();
      void this.checkAccount(id);
      return;
    }
    try {
      await this.options.accountCache.refresh(id);
      if (version !== this.options.getPageVersion()) return;
      this.activeAccount = this.options.accountCache.get(id);
      this.renderAccount();
    } catch (caught) {
      const error = asError(caught);
      if (version !== this.options.getPageVersion()) return;
      this.app.replaceChildren(
        <h1 className="error-title">Could not load this card.</h1>,
      );
      this.options.syncFailure(error, () => this.accountPage(id));
    }
  };

  private readonly renderAccount = () => {
    if (this.activeAccount === undefined) return;
    this.app.replaceChildren(...account());
    query<HTMLElement>("#person-name").textContent = this.activeAccount.name;
    document.title = `${this.activeAccount.name} · Credit Cards`;
    query<HTMLElement>("#single-card").append(
      this.options.card(this.activeAccount),
    );
    query<HTMLButtonElement>("#print-one").onclick = () =>
      this.options.printCards(
        this.activeAccount !== undefined ? [this.activeAccount] : [],
      );
    query<HTMLButtonElement>("#add").onclick = () => this.changeCredit(1);
    query<HTMLButtonElement>("#remove").onclick = () => this.changeCredit(-1);
    query<HTMLButtonElement>("#refresh").onclick = this.refreshBalance;
    this.updateBalance();
  };

  readonly updateBalance = () => {
    if (this.activeAccount === undefined) return;
    query<HTMLElement>(".credit-actions").hidden = !this.options
      .isAuthenticated();
    const print = optional<HTMLButtonElement>("#print-one");
    if (print !== null) print.hidden = !this.options.isAuthenticated();
    query<HTMLElement>("#credit-value").textContent = this.activeAccount.balance
      .toLocaleString();
    const disabled = !this.options.isAuthenticated() ||
      this.options.accountCache.failed ||
      Date.now() < this.readyAt;
    query<HTMLButtonElement>("#add").disabled = disabled ||
      this.activeAccount.balance >= 1000000;
    query<HTMLButtonElement>("#remove").disabled = disabled ||
      this.activeAccount.balance <= 0;
  };

  readonly changeCredit = (delta: 1 | -1) => {
    if (
      this.activeAccount === undefined || !this.options.isAuthenticated() ||
      this.options.accountCache.failed ||
      Date.now() < this.readyAt
    ) return;
    try {
      this.options.accountCache.enqueue(
        this.activeAccount.id,
        delta,
        this.requestId(),
      );
    } catch (caught) {
      const error = asError(caught);
      this.updateBalance();
      this.options.syncFailure(error, () => this.options.accountCache.retry());
    }
  };

  readonly refreshBalance = async () => {
    if (this.activeAccount !== undefined) {
      await this.checkAccount(this.activeAccount.id);
    }
  };

  updateAccess() {
    if (
      this.activeAccount !== undefined && optional("#credit-value") !== null
    ) this.updateBalance();
  }
}
