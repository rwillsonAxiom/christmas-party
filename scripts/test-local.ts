import { prepareLocalDatabase } from "./dev-db.ts";
const { testUrl } = await prepareLocalDatabase();
const result = await new Deno.Command(Deno.execPath(), {
  args: ["task", "test"],
  env: { TEST_DATABASE_URL: testUrl },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}).output();
Deno.exitCode = result.code;
