import encodeQR from "jsr:@paulmillr/qr@0.7.2";
import { databaseFailure, type Sql } from "./database.ts";
import { Accounts, AppError, UUID } from "./store.ts";
import { StaffAuth } from "./auth.ts";

export interface ApiOptions {
  publicUrl: string;
  staffPassword?: string;
}
export function createApi(sql: Sql, options: ApiOptions) {
  const frontend = new URL(options.publicUrl);
  if (
    !["http:", "https:"].includes(frontend.protocol) || frontend.search ||
    frontend.hash || frontend.username || frontend.password
  ) {
    throw new Error(
      "PUBLIC_URL must be an HTTP(S) frontend URL without credentials, query or fragment.",
    );
  }
  const publicUrl = frontend.href.replace(/\/$/, "");
  const accounts = new Accounts(sql);
  const auth = new StaffAuth(sql, options.staffPassword);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Vary": "Origin",
    };
    if (origin === frontend.origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    }
    const json = (data: unknown, status = 200) =>
      Response.json(data, { status, headers });
    const withUrl = (account: Awaited<ReturnType<Accounts["get"]>>) => ({
      ...account,
      url: `${publicUrl}/#/account/${account.id}`,
    });
    try {
      if (origin && origin !== frontend.origin) {
        throw new AppError(
          403,
          "This website is not allowed to access the API.",
        );
      }
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }
      if (
        request.method === "POST" &&
        !request.headers.get("content-type")?.startsWith("application/json")
      ) throw new AppError(415, "Send JSON data.");
      if (url.pathname === "/api/session" && request.method === "GET") {
        return json({ authenticated: await auth.authenticated(request) });
      }
      if (url.pathname === "/api/login" && request.method === "POST") {
        const body = await request.json();
        return json({
          authenticated: true,
          ...await auth.login(body?.password, request),
        });
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        await auth.logout(request);
        return json({ authenticated: false });
      }
      if (url.pathname === "/api/accounts") {
        if (request.method === "GET") {
          return json({ accounts: (await accounts.list()).map(withUrl) });
        }
        if (request.method === "POST") {
          await auth.require(request);
          const body = await request.json();
          if (!body || typeof body !== "object") {
            throw new AppError(
              400,
              "Send an account name and starting balance.",
            );
          }
          return json(
            withUrl(await accounts.create(body.name, body.balance ?? 0)),
            201,
          );
        }
        return json({ error: "Method not allowed." }, 405);
      }
      const match = url.pathname.match(
        /^\/api\/accounts\/([^/]+)(?:\/(credits|qr))?$/,
      );
      if (match) {
        const [, id, action] = match;
        if (!UUID.test(id)) throw new AppError(404, "Account not found.");
        if (request.method === "GET" && action === "qr") {
          const svg = encodeQR(
            withUrl(await accounts.get(id)).url,
            "svg",
            { ecc: "medium", border: 4, scale: 5 },
          );
          return new Response(svg, {
            headers: { ...headers, "Content-Type": "image/svg+xml" },
          });
        }
        if (request.method === "GET" && !action) {
          return json(withUrl(await accounts.get(id)));
        }
        if (request.method === "POST" && action === "credits") {
          await auth.require(request);
          const body = await request.json();
          if (!body || typeof body !== "object") {
            throw new AppError(400, "Send a credit change.");
          }
          return json(
            withUrl(await accounts.adjust(id, body.delta, body.requestId)),
          );
        }
        return json({ error: "Method not allowed." }, 405);
      }
      return json({ error: "Endpoint not found." }, 404);
    } catch (error) {
      if (error instanceof AppError) {
        return json({ error: error.message }, error.status);
      }
      if (error instanceof SyntaxError) {
        return json({ error: "Invalid JSON data." }, 400);
      }
      const failure = databaseFailure(error);
      console.error("API request failed.", failure);
      return json(
        { error: failure.message },
        503,
      );
    }
  };
}
