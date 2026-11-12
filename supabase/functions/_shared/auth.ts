import { timingSafeEqual } from "node:crypto";
import type { Sql } from "./database.ts";
import { AppError } from "./store.ts";

const SESSION_MS = 12 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

export class StaffAuth {
  constructor(private sql: Sql, private password?: string) {}
  private token(request: Request): string | undefined {
    return request.headers.get("authorization")?.match(
      /^Bearer ([0-9a-f]{64})$/i,
    )?.[1];
  }
  private async key(token: string): Promise<string> {
    // Bind sessions to the password; persist neither passwords nor raw tokens.
    return hex(await digest(`${this.password}\0${token}`));
  }
  async authenticated(request: Request): Promise<boolean> {
    if (!this.password) return false;
    const token = this.token(request);
    if (!token) return false;
    const rows = await this
      .sql`SELECT token_hash FROM credit_cards.staff_sessions WHERE token_hash = ${await this
      .key(token)} AND expires_at > now()`;
    return rows.length > 0;
  }
  async require(request: Request) {
    if (!await this.authenticated(request)) {
      throw new AppError(401, "Staff sign-in required.");
    }
  }
  async login(
    password: unknown,
    request: Request,
  ): Promise<{ token: string; expiresAt: string }> {
    if (!this.password) {
      throw new AppError(
        503,
        "Staff login is not configured. Set STAFF_PASSWORD on the server.",
      );
    }
    await this
      .sql`DELETE FROM credit_cards.login_attempts WHERE window_start < now() - interval '2 minutes'`;
    const attempts = await this.sql<
      { attempts: number }[]
    >`INSERT INTO credit_cards.login_attempts (window_start, attempts) VALUES (date_trunc('minute', now()), 1) ON CONFLICT (window_start) DO UPDATE SET attempts = credit_cards.login_attempts.attempts + 1 RETURNING attempts`;
    if (attempts[0].attempts > 30) {
      throw new AppError(
        429,
        "Too many sign-in attempts. Try again in a minute.",
      );
    }
    if (
      typeof password !== "string" || password.length > 1024 ||
      !timingSafeEqual(await digest(password), await digest(this.password))
    ) throw new AppError(401, "Incorrect staff password.");
    await this.logout(request);
    await this
      .sql`DELETE FROM credit_cards.staff_sessions WHERE expires_at <= now()`;
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
    await this
      .sql`INSERT INTO credit_cards.staff_sessions (token_hash, expires_at) VALUES (${await this
      .key(token)}, ${expiresAt})`;
    return { token, expiresAt };
  }
  async logout(request: Request): Promise<void> {
    const token = this.token(request);
    if (token && this.password) {
      await this
        .sql`DELETE FROM credit_cards.staff_sessions WHERE token_hash = ${await this
        .key(token)}`;
    }
  }
}
