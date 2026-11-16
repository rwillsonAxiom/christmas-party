import { createApi } from "supabase/functions/_shared/api.ts";
import { connectDatabase } from "supabase/functions/_shared/database.ts";
import { hostedHandler } from "supabase/functions/credit-cards/handler.ts";

const connectionString = Deno.env.get("SUPABASE_DB_URL");
const publicUrl = Deno.env.get("PUBLIC_URL");
if (
  connectionString === undefined || connectionString.length === 0 ||
  publicUrl === undefined || publicUrl.length === 0
) {
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
