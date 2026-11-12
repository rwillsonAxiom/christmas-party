import {
  connectDatabase,
  databaseFailure,
} from "../supabase/functions/_shared/database.ts";

const connection = Deno.env.get("APP_DATABASE_URL");
if (!connection) throw new Error("APP_DATABASE_URL is missing from .env.");
const url = new URL(connection);
console.log(
  "Database target:",
  JSON.stringify({
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.slice(1),
    passwordSet: Boolean(url.password),
    staffPasswordSet: Boolean(Deno.env.get("STAFF_PASSWORD")),
    publicUrl: Deno.env.get("PUBLIC_URL"),
  }),
);
const sql = connectDatabase(connection);
try {
  await sql`SELECT 1`;
  console.log("Database connection: OK");
  const tables =
    await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'credit_cards' ORDER BY table_name`;
  console.log(
    "App tables:",
    tables.map((r) => r.table_name).join(", ") ||
      "NONE — the database migration has not been applied.",
  );
  await sql`SELECT id, name, balance, created_at FROM credit_cards.accounts LIMIT 0`;
  console.log("Account query: OK");
} catch (error) {
  console.error(databaseFailure(error).message);
  const detail = error as {
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const scrub = (text: string | undefined) => {
    let safe = text ?? "";
    for (
      const secret of [
        connection,
        url.password,
        decodeURIComponent(url.password),
        Deno.env.get("STAFF_PASSWORD"),
      ]
    ) if (secret) safe = safe.split(secret).join("[redacted]");
    return safe.replace(
      /postgres(?:ql)?:\/\/[^\s]+/g,
      "[database URL redacted]",
    );
  };
  console.error(
    JSON.stringify({
      name: detail.name,
      code: detail.code,
      message: scrub(detail.message),
      causeCode: detail.cause?.code,
      cause: scrub(detail.cause?.message),
    }),
  );
  Deno.exitCode = 1;
} finally {
  await sql.end();
}
