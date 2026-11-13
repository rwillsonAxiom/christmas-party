import {
  type Account,
  type Api,
  asError,
  type CreditOperation,
} from "./types.ts";

// Confirmed server records and unacknowledged deltas are kept separately.
// Reads can never replace a record while its writes are pending.
export class AccountCache {
  private readonly api!: Api;
  private readonly cacheStorage?: Pick<Storage, "getItem" | "setItem">;
  private readonly queueStorage?: Pick<Storage, "getItem" | "setItem">;
  private readonly key!: string;
  private readonly onChange!: () => void;
  private readonly onError!: (error: Error) => void;
  private readonly records = new Map<string, Account>();
  private readonly revisions = new Map<string, number>();
  queue: CreditOperation[] = [];
  running = false;
  failed = false;
  constructor(options: {
    api: Api;
    cacheStorage?: Pick<Storage, "getItem" | "setItem">;
    queueStorage?: Pick<Storage, "getItem" | "setItem">;
    key: string;
    onChange: () => void;
    onError: (error: Error) => void;
  }) {
    Object.assign(this, options);
    const { cacheStorage, queueStorage, key } = options;
    try {
      for (const account of JSON.parse(cacheStorage?.getItem(key) || "[]")) {
        this.remember(account);
      }
    } catch {
      /* A damaged public cache must not prevent restoring the outbox. */
    }
    try {
      const saved = JSON.parse(queueStorage?.getItem(key) || "null");
      if (saved) {
        for (const account of saved.records) this.remember(account);
        this.queue = saved.queue;
      }
    } catch { /* Unavailable session storage leaves this tab's queue empty. */ }
  }

  remember(account: Account) {
    if (
      !account || typeof account.id !== "string" ||
      typeof account.name !== "string" ||
      !Number.isSafeInteger(account.balance) ||
      account.balance < 0 || account.balance > 1_000_000
    ) return;
    this.records.set(account.id, { ...account });
  }

  get(id: string) {
    const record = this.records.get(id);
    if (!record) return;
    const balance = this.queue.filter((op) => op.accountId === id)
      .reduce((sum, op) => sum + op.delta, record.balance);
    return { ...record, balance };
  }

  list() {
    return [...this.records.keys()].map((id) => this.get(id)!)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  pending(id: string) {
    return this.queue.some((op) => op.accountId === id);
  }

  revision(id: string) {
    return this.revisions.get(id) || 0;
  }

  changed(id: string) {
    this.revisions.set(id, this.revision(id) + 1);
  }

  persist() {
    // One atomic snapshot retains both receipts and their pre-write balances.
    // sessionStorage isolates each tab's outbox and survives a page reload.
    this.queueStorage?.setItem(
      this.key,
      JSON.stringify({
        records: [...this.records.values()].filter((a) => this.pending(a.id)),
        queue: this.queue,
      }),
    );
    try {
      this.cacheStorage?.setItem(
        this.key,
        JSON.stringify([...this.records.values()]),
      );
    } catch { /* Account reads can still use the in-memory cache. */ }
  }

  async refresh(id: string) {
    if (this.pending(id)) return this.get(id);
    const revision = this.revision(id);
    const account = await this.api(`/api/accounts/${id}`);
    if (!this.pending(id) && revision === this.revision(id)) {
      this.remember(account);
      this.persist();
      this.onChange();
    }
    return this.get(id);
  }

  async refreshAll() {
    const revisions = new Map(this.revisions);
    const { accounts } = await this.api<{ accounts: Account[] }>(
      "/api/accounts",
    );
    for (const account of accounts) {
      if (
        !this.pending(account.id) &&
        (revisions.get(account.id) || 0) === this.revision(account.id)
      ) this.remember(account);
    }
    this.persist();
    this.onChange();
  }

  enqueue(accountId: string, delta: 1 | -1, requestId: string) {
    if (this.failed) {
      throw new Error("Retry the queued changes before making more changes.");
    }
    if (!this.queueStorage) {
      throw new Error(
        "Browser storage is unavailable. Allow storage for this website before changing credits.",
      );
    }
    const account = this.get(accountId);
    if (!account || ![1, -1].includes(delta)) {
      throw new Error("Scan an account first.");
    }
    if (account.balance + delta < 0 || account.balance + delta > 1_000_000) {
      throw new Error("This change would exceed the account balance limits.");
    }
    this.queue.push({ accountId, delta, requestId });
    try {
      this.persist();
    } catch {
      this.queue.pop();
      throw new Error(
        "Could not save the queued change on this device. Free browser storage and retry.",
      );
    }
    this.changed(accountId);
    this.onChange();
    void this.drain();
  }

  async drain() {
    if (this.running || this.failed) return;
    this.running = true;
    try {
      while (this.queue.length && !this.failed) {
        const operation = this.queue[0];
        const { accountId, delta, requestId } = operation;
        try {
          const account = await this.api(`/api/accounts/${accountId}/credits`, {
            delta,
            requestId,
          });
          const previous = this.records.get(accountId);
          this.remember(account);
          this.queue.shift();
          this.changed(accountId);
          try {
            this.persist();
          } catch (error) {
            // Retrying an acknowledged receipt is safe, even if saving the
            // acknowledgement locally failed. Keep its original base meanwhile.
            if (previous) this.records.set(accountId, previous);
            else this.records.delete(accountId);
            this.queue.unshift(operation);
            throw error;
          }
          this.onChange();
        } catch (caught) {
          const error = asError(caught);
          this.failed = true;
          // A definitive rejection did not apply. Undo its optimistic delta.
          // Network/server/auth failures keep the receipt for an identical retry.
          const rejected = error.status !== undefined && error.status >= 400 &&
            error.status < 500 &&
            ![401, 403, 408, 429].includes(error.status);
          if (rejected && this.queue[0] === operation) {
            // Later changes for this account were based on the rejected balance.
            // Cancel them together; unrelated accounts remain queued.
            this.queue = this.queue.filter((op) => op.accountId !== accountId);
            this.changed(accountId);
            try {
              this.persist();
            } catch {
              /* The rejected receipt is safe to retry after reload. */
            }
          }
          this.onChange();
          this.onError(
            new Error(
              rejected
                ? `${error.message} Unsynced changes for ${
                  this.records.get(accountId)?.name || "this account"
                } were undone locally. Other accounts' changes remain queued.`
                : `${error.message} Changes are saved on this device and are waiting to sync.`,
            ),
          );
          if (rejected) void this.refresh(accountId).catch(() => {});
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }

  retry() {
    this.failed = false;
    this.onChange();
    return this.drain();
  }
}
