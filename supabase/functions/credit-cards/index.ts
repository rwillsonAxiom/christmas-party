import { createApi } from "../_shared/api.ts";
import { connectDatabase } from "../_shared/database.ts";
import { hostedHandler } from "./handler.ts";

const connectionString = Deno.env.get("SUPABASE_DB_URL");
const publicUrl = Deno.env.get("PUBLIC_URL");
if (!connectionString || !publicUrl) {
  throw new Error(
    "Supabase must supply SUPABASE_DB_URL, and PUBLIC_URL must be configured by deployment.",
  );
}
const sql = connectDatabase(connectionString);
const api = createApi(sql, {
  publicUrl,
  staffPassword: Deno.env.get("STAFF_PASSWORD"),
});
Deno.serve(hostedHandler(api));
