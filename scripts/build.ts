const apiBaseUrl = Deno.env.get("API_BASE_URL");
if (!apiBaseUrl) {
  throw new Error(
    "Set API_BASE_URL to the backend URL before building GitHub Pages.",
  );
}
const url = new URL(apiBaseUrl);
if (
  url.protocol !== "https:" &&
  !(url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname))
) {
  throw new Error(
    "API_BASE_URL must use HTTPS (HTTP is permitted for local tests).",
  );
}
if (url.username || url.password || url.search || url.hash) {
  throw new Error(
    "API_BASE_URL cannot contain credentials, query or fragment.",
  );
}
await Deno.mkdir("dist", { recursive: true });
const html = (await Deno.readTextFile("dist/index.html"))
  .replace("connect-src 'self';", `connect-src 'self' ${url.origin};`)
  .replace("img-src 'self';", `img-src 'self' ${url.origin};`)
  .replace(
    'name="credit-cards-api" content=""',
    `name="credit-cards-api" content="${url.href.replace(/\/$/, "")}"`,
  );
await Deno.writeTextFile("dist/index.html", html);
await Deno.writeTextFile("dist/.nojekyll", "");
console.log("Configured bundled frontend in dist/ for GitHub Pages.");
