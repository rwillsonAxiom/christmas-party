import type { Account } from "web/types.ts";

export class AccountRowElement extends HTMLElement {
  private account: Account | undefined;
  private staff = false;
  private onPrint: (() => void) | undefined;

  configure(account: Account, staff: boolean, onPrint: () => void): this {
    this.account = account;
    this.staff = staff;
    this.onPrint = onPrint;
    if (this.isConnected) this.render();
    return this;
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    const account = this.account;
    if (account === undefined) return;
    const row = (
      <article className="account-row">
        <span className="avatar" aria-hidden="true">
          {account.name.slice(0, 1).toUpperCase()}
        </span>
        <a className="account-name" href={`#/account/${account.id}`}>
          {account.name}
        </a>
        <span className="balance-pill">
          {`${account.balance.toLocaleString()} ${
            account.balance === 1 ? "credit" : "credits"
          }`}
        </span>
      </article>
    );
    if (this.staff) {
      row.append(
        <button
          type="button"
          className="text-button"
          onclick={() => this.onPrint?.()}
        >
          Print card
        </button>,
      );
    }

    this.replaceChildren(row);
  }
}

customElements.define("account-row", AccountRowElement);
declare global {
  interface HTMLElementTagNameMap {
    "account-row": AccountRowElement;
  }
}
