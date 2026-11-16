import type { Account } from "web/types.ts";

export class AccountCardElement extends HTMLElement {
  private account: Account | undefined;
  private qrUrl = "";

  configure(account: Account, qrUrl: string): this {
    this.account = account;
    this.qrUrl = qrUrl;
    if (this.isConnected) this.render();
    return this;
  }

  connectedCallback() {
    this.render();
  }

  private render() {
    const account = this.account;
    if (account === undefined) return;
    this.replaceChildren(
      <article className="paper-card">
        <span className="eyebrow">YOUR CREDIT CARD</span>
        <h2 className="card-name">{account.name}</h2>
        <img
          className="qr"
          src={this.qrUrl}
          alt={`QR code for ${account.name}'s account`}
          width={220}
          height={220}
        />
        <p className="card-caption">Scan to view your credits</p>
        <small className="card-link">{account.url}</small>
      </article>,
    );
  }
}

customElements.define("account-card", AccountCardElement);
declare global {
  interface HTMLElementTagNameMap {
    "account-card": AccountCardElement;
  }
}
