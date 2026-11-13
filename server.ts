import { createApi } from "./supabase/functions/_shared/api.ts";
import { connectDatabase } from "./supabase/functions/_shared/database.ts";

const connectionString = Deno.env.get("APP_DATABASE_URL");
if (!connectionString) {
  throw new Error("Set APP_DATABASE_URL in .env before starting the server.");
}
const sql = connectDatabase(connectionString);
const port = Number(Deno.env.get("PORT") ?? 8000);
const hostname = Deno.env.get("HOST") ?? "0.0.0.0";
const publicUrl = Deno.env.get("PUBLIC_URL") || `http://localhost:${port}`;
const api = createApi(sql, {
  publicUrl,
  staffPassword: Deno.env.get("STAFF_PASSWORD"),
});
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/manifest.webmanifest": [
    "manifest.webmanifest",
    "application/manifest+json",
  ],
  "/qr-LICENSE.txt": ["qr-LICENSE.txt", "text/plain; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
// HTML bundling gives the generated entry a content-hashed filename.
for await (const entry of Deno.readDir(new URL("./dist/", import.meta.url))) {
  if (entry.isFile && entry.name.endsWith(".js")) {
    assets[`/${entry.name}`] = [entry.name, "text/javascript; charset=utf-8"];
  }
}
console.log(`Credit Cards: http://localhost:${port}`);
Deno.serve({ hostname, port }, async (request) => {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/")) return api(request);
  if (!["GET", "HEAD"].includes(request.method) || !assets[path]) {
    return new Response("Not found", { status: 404 });
  }
  const [file, type] = assets[path];
  return new Response(
    request.method === "HEAD"
      ? null
      : await Deno.readFile(new URL(`./dist/${file}`, import.meta.url)),
    {
      headers: {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
});
