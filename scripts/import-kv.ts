import { connectDatabase } from "../supabase/functions/_shared/database.ts";
import type { Account } from "../supabase/functions/_shared/store.ts";
const connectionString = Deno.env.get("APP_DATABASE_URL");
if (!connectionString) throw new Error("Set APP_DATABASE_URL in .env first.");
using kv = await Deno.openKv("./data/credits.kv");
const sql = connectDatabase(connectionString);
try {
  let inserted = 0;
  let skipped = 0;
  await sql.begin(async (tx) => {
    for await (
      const { value: a } of kv.list<Account>({ prefix: ["accounts"] })
    ) {
      const rows =
        await tx`INSERT INTO credit_cards.accounts (id, name, balance, created_at) VALUES (${a.id}, ${a.name}, ${a.balance}, ${a.createdAt}) ON CONFLICT (id) DO NOTHING RETURNING id`;
      if (rows.length) inserted++;
      else skipped++;
    }
    for await (
      const { key, value } of kv.list<{ delta: number }>({
        prefix: ["operations"],
      })
    ) {
      await tx`INSERT INTO credit_cards.credit_operations (account_id, request_id, delta) VALUES (${
        String(key[1])
      }, ${String(key[2])}, ${value.delta}) ON CONFLICT DO NOTHING`;
    }
  });
  console.log(
    `Imported ${inserted} accounts; preserved ${skipped} existing PostgreSQL accounts. KV was retained. Staff must sign in again.`,
  );
} finally {
  await sql.end();
}
