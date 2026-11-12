import type { Sql } from "./database.ts";

export interface Account {
  id: string;
  name: string;
  balance: number;
  createdAt: string;
}
export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AccountRow = {
  id: string;
  name: string;
  balance: number;
  created_at: Date | string;
};
const account = (row: AccountRow): Account => ({
  id: row.id,
  name: row.name,
  balance: row.balance,
  createdAt: new Date(row.created_at).toISOString(),
});

export class Accounts {
  constructor(private sql: Sql) {}
  async list(): Promise<Account[]> {
    const rows = await this.sql<
      AccountRow[]
    >`SELECT id, name, balance, created_at FROM credit_cards.accounts ORDER BY name, id`;
    return rows.map(account);
  }
  async get(id: string): Promise<Account> {
    if (!UUID.test(id)) throw new AppError(404, "Account not found.");
    const rows = await this.sql<
      AccountRow[]
    >`SELECT id, name, balance, created_at FROM credit_cards.accounts WHERE id = ${id}`;
    if (!rows.length) throw new AppError(404, "Account not found.");
    return account(rows[0]);
  }
  async create(name: unknown, balance: unknown): Promise<Account> {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      throw new AppError(400, "Enter a name between 1 and 80 characters.");
    }
    if (
      typeof balance !== "number" || !Number.isSafeInteger(balance) ||
      balance < 0 || balance > 1_000_000
    ) {
      throw new AppError(
        400,
        "Starting credits must be a whole number between 0 and 1,000,000.",
      );
    }
    const rows = await this.sql<
      AccountRow[]
    >`INSERT INTO credit_cards.accounts (id, name, balance) VALUES (${crypto.randomUUID()}, ${name.trim()}, ${balance}) RETURNING id, name, balance, created_at`;
    return account(rows[0]);
  }
  async adjust(
    id: string,
    delta: unknown,
    requestId: unknown,
  ): Promise<Account> {
    if (delta !== 1 && delta !== -1) {
      throw new AppError(400, "Change must be +1 or -1.");
    }
    if (typeof requestId !== "string" || !UUID.test(requestId)) {
      throw new AppError(400, "A valid request ID is required.");
    }
    if (!UUID.test(id)) throw new AppError(404, "Account not found.");
    // The account lock serializes changes across server instances. The receipt
    // and balance commit together, so an uncertain request can be retried safely.
    const rows = await this.sql.begin(async (tx) => {
      const existing = await tx<
        AccountRow[]
      >`SELECT id, name, balance, created_at FROM credit_cards.accounts WHERE id = ${id} FOR UPDATE`;
      if (!existing.length) throw new AppError(404, "Account not found.");
      const operations = await tx<
        { delta: number }[]
      >`SELECT delta FROM credit_cards.credit_operations WHERE account_id = ${id} AND request_id = ${requestId}`;
      if (operations.length) {
        if (operations[0].delta !== delta) {
          throw new AppError(
            409,
            "Request ID already used for a different change.",
          );
        }
        return existing;
      }
      const balance = existing[0].balance + delta;
      if (balance < 0) {
        throw new AppError(409, "This account has no credits to remove.");
      }
      if (balance > 1_000_000) {
        throw new AppError(409, "Maximum balance reached.");
      }
      const updated = await tx<
        AccountRow[]
      >`UPDATE credit_cards.accounts SET balance = ${balance} WHERE id = ${id} RETURNING id, name, balance, created_at`;
      await tx`INSERT INTO credit_cards.credit_operations (account_id, request_id, delta) VALUES (${id}, ${requestId}, ${delta})`;
      return updated;
    });
    return account(rows[0]);
  }
}
