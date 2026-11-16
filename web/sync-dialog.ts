import { query } from "web/dom.ts";
import { asError } from "web/types.ts";
import type { AccountCache } from "web/account-cache.ts";
export class SyncDialog {
  private syncRetry: (() => void | Promise<void>) | undefined;
  constructor(
    private readonly accountCache: AccountCache,
    private readonly fallbackRetry: () => Promise<void>,
  ) {
    query<HTMLButtonElement>("#sync-retry").onclick = async () => {
      query<HTMLDialogElement>("#sync-dialog").close();
      try {
        await this.syncRetry?.();
      } catch (caught) {
        const error = asError(caught);
        this.show(error, this.syncRetry ?? this.fallbackRetry);
      }
    };
    query<HTMLButtonElement>("#sync-later").onclick = () =>
      query<HTMLDialogElement>("#sync-dialog").close();
    query<HTMLDialogElement>("#sync-dialog").addEventListener(
      "cancel",
      (event) => {
        if (this.accountCache.failed) event.preventDefault();
      },
    );
    query<HTMLAnchorElement>("#sync-sign-in").onclick = () =>
      query<HTMLDialogElement>("#sync-dialog").close();
  }
  readonly show = (error: Error, retry: () => void | Promise<void>) => {
    this.syncRetry = this.accountCache.failed
      ? () => this.accountCache.retry()
      : retry;
    const dialog = query<HTMLDialogElement>("#sync-dialog");
    query<HTMLButtonElement>("#sync-later").hidden = this.accountCache.failed;
    query<HTMLElement>("#sync-error").textContent = error.message;
    if (!dialog.open) dialog.showModal();
  };
}
