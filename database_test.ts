import { databaseFailure } from "./supabase/functions/_shared/database.ts";

Deno.test("database diagnostics distinguish setup failures without exposing credentials", () => {
  const cases = [
    [{
      code: "28P01",
      message: "password rejected for postgres://user:private-password@host/db",
    }, "login was rejected"],
    [{ code: "42P01" }, "tables are missing"],
    [{ cause: { code: "ECONNREFUSED" } }, "connection was refused"],
    [
      { message: "postgres://user:private-password@host/db" },
      "deno task diagnose",
    ],
  ] as const;
  for (const [error, expected] of cases) {
    const result = databaseFailure(error);
    if (!result.message.includes(expected)) {
      throw new Error(`Missing diagnostic: ${expected}`);
    }
    if (JSON.stringify(result).includes("private-password")) {
      throw new Error("Diagnostic exposed a credential");
    }
  }
});
