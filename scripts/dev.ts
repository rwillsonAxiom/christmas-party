import { prepareLocalDatabase } from "scripts/dev-db.ts";

const { url } = await prepareLocalDatabase();
Deno.env.set("APP_DATABASE_URL", url);
const publicUrl = Deno.env.get("DEV_PUBLIC_URL");
const port = Deno.env.get("PORT");
Deno.env.set(
  "PUBLIC_URL",
  publicUrl !== undefined && publicUrl.length > 0
    ? publicUrl
    : `http://localhost:${
      port === undefined || port.length === 0 ? 8000 : port
    }`,
);
const staffPassword = Deno.env.get("STAFF_PASSWORD");
if (staffPassword === undefined || staffPassword.length === 0) {
  Deno.env.set("STAFF_PASSWORD", "local-dev");
  console.log(
    "Local staff password: local-dev (set STAFF_PASSWORD in .env to override)",
  );
}
await import("server/main.ts");
