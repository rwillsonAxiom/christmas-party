import postgres from "npm:postgres@3.4.7";
export type { Sql } from "npm:postgres@3.4.7";

/** Actionable connection diagnostics without echoing connection strings or secrets. */
export function databaseFailure(
  error: unknown,
): { code: string; message: string } {
  const detail = error && typeof error === "object"
    ? error as { code?: unknown; cause?: { code?: unknown } }
    : {};
  const rawCode = detail.code ?? detail.cause?.code;
  const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,32}$/.test(rawCode)
    ? rawCode
    : "UNKNOWN";
  const messages: Record<string, string> = {
    "28P01":
      "Database login was rejected. Check the username and password in APP_DATABASE_URL, then restart the server.",
    "28000":
      "Database access was rejected. Check APP_DATABASE_URL and the database's connection settings.",
    "3D000":
      "The configured database does not exist. Create it or correct APP_DATABASE_URL.",
    "42P01":
      "The application tables are missing. Apply the PostgreSQL migration to the configured database.",
    "3F000":
      "The application schema is missing. Apply the PostgreSQL migration to the configured database.",
    "42501":
      "The database user cannot access the application tables. Check its schema and table permissions.",
    "ECONNREFUSED":
      "The database connection was refused. Check that PostgreSQL is running at the configured host and port.",
    "ENOTFOUND":
      "The database hostname could not be resolved. Check APP_DATABASE_URL and whether the Supabase project is active.",
    "EAI_AGAIN":
      "The database hostname could not be resolved. Check the network connection and try again.",
    "CONNECT_TIMEOUT":
      "The database connection timed out. Check the host, port, network access and whether the Supabase project is active.",
    "ETIMEDOUT":
      "The database connection timed out. Check the host, port and network access.",
  };
  return {
    code,
    message: messages[code] ??
      "The database request failed. Run deno task diagnose from the app directory for connection details.",
  };
}

export function connectDatabase(connectionString: string, max = 1) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("APP_DATABASE_URL must be a PostgreSQL connection string.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return postgres(connectionString, {
    max,
    prepare: false,
    // Supported at runtime in 3.4.7, but missing from that release's typings.
    ...{ max_pipeline: 1 },
    ssl: local ? false : "require",
    idle_timeout: 20,
    connect_timeout: 10,
  });
}
