import { createApi } from "../_shared/api.ts";
import { connectDatabase } from "../_shared/database.ts";
import { hostedHandler } from "./handler.ts";

const connectionString = Deno.env.get("APP_DATABASE_URL");
const publicUrl = Deno.env.get("PUBLIC_URL");
if (!connectionString || !publicUrl) {
  throw new Error(
    "Configure APP_DATABASE_URL and PUBLIC_URL in Supabase Edge Function secrets.",
  );
}
const sql = connectDatabase(connectionString);
const api = createApi(sql, {
  publicUrl,
  staffPassword: Deno.env.get("STAFF_PASSWORD"),
});
Deno.serve(hostedHandler(api));
