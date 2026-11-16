import { AccountCardElement } from "web/views/account-card.tsx";
import { query } from "web/dom.ts";
import type { Account } from "web/types.ts";
export class CardPrinting {
  private readonly printArea = query("#print-cards");
  constructor(
    private readonly apiUrl: (path: string) => string,
    private readonly notice: (text: string, error?: boolean) => void,
  ) {}
  readonly card = (account: Account) => {
    return new AccountCardElement().configure(
      account,
      this.apiUrl(`/api/accounts/${account.id}/qr`),
    );
  };

  readonly printCards = async (items: Account[]) => {
    this.printArea.replaceChildren(...items.map(this.card));
    try {
      await Promise.all(
        [...this.printArea.querySelectorAll("img")].map((img) => img.decode()),
      );
      globalThis.print();
    } catch {
      this.notice(
        "Could not load the QR codes. Please try printing again.",
        true,
      );
    }
  };
}
