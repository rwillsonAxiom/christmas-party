import { prepareLocalDatabase } from "./scripts/dev-db.ts";

const { url } = await prepareLocalDatabase();
Deno.env.set("APP_DATABASE_URL", url);
Deno.env.set(
  "PUBLIC_URL",
  Deno.env.get("DEV_PUBLIC_URL") ||
    `http://localhost:${Deno.env.get("PORT") || 8000}`,
);
if (!Deno.env.get("STAFF_PASSWORD")) {
  Deno.env.set("STAFF_PASSWORD", "local-dev");
  console.log(
    "Local staff password: local-dev (set STAFF_PASSWORD in .env to override)",
  );
}
await import("./server.ts");
