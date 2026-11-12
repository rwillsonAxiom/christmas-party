import { createApi } from "./supabase/functions/_shared/api.ts";
import { connectDatabase } from "./supabase/functions/_shared/database.ts";
import { Accounts, AppError } from "./supabase/functions/_shared/store.ts";
import { hostedHandler } from "./supabase/functions/credit-cards/handler.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Supabase route adapter preserves JSON bodies and bearer headers", async () => {
  const handler = hostedHandler(async (request) =>
    Response.json({
      path: new URL(request.url).pathname,
      body: await request.json(),
      auth: request.headers.get("authorization"),
      origin: request.headers.get("origin"),
    })
  );
  for (const prefix of ["/functions/v1/credit-cards", "/credit-cards"]) {
    const result = await (await handler(
      new Request(`https://backend.example${prefix}/api/accounts`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          Origin: "https://example.github.io",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Alex", balance: 2 }),
      }),
    )).json();
    assert(
      result.path === "/api/accounts" && result.body.name === "Alex" &&
        result.auth === "Bearer test-token" &&
        result.origin === "https://example.github.io",
    );
  }
});

Deno.test("PostgreSQL storage and API integration", async (t) => {
  const connection = Deno.env.get("TEST_DATABASE_URL");
  if (!connection || !new URL(connection).pathname.endsWith("_test")) {
    throw new Error(
      "Set TEST_DATABASE_URL to an isolated PostgreSQL database whose name ends in _test. Tests replace only that database's credit_cards schema.",
    );
  }
  const sql = connectDatabase(connection, 6);
  try {
    const [{ name }] = await sql<
      { name: string }[]
    >`SELECT current_database() AS name`;
    assert(name.endsWith("_test"), "Refusing to modify a non-test database");
    await sql.unsafe("DROP SCHEMA IF EXISTS credit_cards CASCADE");
    const migrations = [];
    for await (const entry of Deno.readDir("./supabase/migrations")) {
      if (entry.name.endsWith(".sql")) migrations.push(entry.name);
    }
    for (const file of migrations.sort()) {
      await sql.unsafe(
        await Deno.readTextFile(`./supabase/migrations/${file}`),
      );
    }
    const store = new Accounts(sql);
    const handler = createApi(sql, {
      publicUrl: "https://example.github.io/credit-cards/",
      staffPassword: "test-password",
    });
    const call = (
      path: string,
      body?: unknown,
      token = "",
      selected = handler,
      origin = "https://example.github.io",
    ) =>
      selected(
        new Request(`https://backend.example${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    let id: string;
    let token: string;

    await t.step(
      "validate accounts and enforce database constraints",
      async () => {
        const a = await store.create("  Alex  ", 2);
        id = a.id;
        assert(a.name === "Alex" && a.balance === 2);
        assert((await store.list())[0].id === id);
        for (
          const [name, balance] of [
            ["", 0],
            ["a".repeat(81), 0],
            ["Alex", -1],
            ["Alex", 1.5],
            ["Alex", "1"],
            ["Alex", 1000001],
          ]
        ) {
          try {
            await store.create(name, balance);
            throw new Error("Invalid account accepted");
          } catch (error) {
            assert(error instanceof AppError && error.status === 400);
          }
        }
        try {
          await sql`UPDATE credit_cards.accounts SET balance = -1 WHERE id = ${id}`;
          throw new Error("Database accepted a negative balance");
        } catch (error) {
          assert(
            error instanceof Error && "code" in error && error.code === "23514",
          );
        }
      },
    );

    await t.step(
      "concurrent additions do not lose updates across connections",
      async () => {
        const a = await store.create("Concurrent", 0);
        await Promise.all(
          Array.from(
            { length: 12 },
            () => store.adjust(a.id, 1, crypto.randomUUID()),
          ),
        );
        assert((await store.get(a.id)).balance === 12);
      },
    );

    await t.step("two phones cannot spend the same final credit", async () => {
      const a = await store.create("Final credit", 1);
      const results = await Promise.allSettled([
        store.adjust(a.id, -1, crypto.randomUUID()),
        store.adjust(a.id, -1, crypto.randomUUID()),
      ]);
      assert(results.filter((r) => r.status === "fulfilled").length === 1);
      assert((await store.get(a.id)).balance === 0);
    });

    await t.step(
      "simultaneous retries apply once, and conflicting retries fail",
      async () => {
        const a = await store.create("Retry", 2);
        const requestId = crypto.randomUUID();
        await Promise.all([
          store.adjust(a.id, -1, requestId),
          store.adjust(a.id, -1, requestId),
        ]);
        await store.adjust(a.id, 1, crypto.randomUUID());
        assert((await store.adjust(a.id, -1, requestId)).balance === 2);
        try {
          await store.adjust(a.id, 1, requestId);
          throw new Error("Conflicting retry accepted");
        } catch (error) {
          assert(error instanceof AppError && error.status === 409);
        }
      },
    );

    await t.step(
      "viewers can read but cannot create accounts or change credits",
      async () => {
        const response = await call(`/api/accounts/${id}`);
        const account = await response.json();
        assert(
          response.status === 200 &&
            account.url ===
              `https://example.github.io/credit-cards/#/account/${id}`,
        );
        assert((await call("/api/accounts")).status === 200);
        assert(
          (await call(`/api/accounts/${id}/credits`, {
            delta: 1,
            requestId: crypto.randomUUID(),
          })).status === 401,
        );
        assert(
          (await call("/api/accounts", { name: "Unauthorized", balance: 100 }))
            .status === 401,
        );
        assert(
          (await call(`/api/accounts/${id}/credits`, {
            delta: 1,
            requestId: crypto.randomUUID(),
          }, "a".repeat(64))).status === 401,
        );
        assert((await call("/api/accounts/not-a-uuid")).status === 404);
      },
    );

    await t.step(
      "password login grants bearer-token permissions, QR and API routes work",
      async () => {
        assert(
          (await call("/api/login", { password: "wrong" })).status === 401,
        );
        const response = await call("/api/login", {
          password: "test-password",
        });
        const session = await response.json();
        token = session.token;
        assert(response.status === 200 && /^[0-9a-f]{64}$/.test(token));
        assert(new Date(session.expiresAt).getTime() > Date.now());
        assert(
          response.headers.get("set-cookie") === null,
          "Cross-origin authentication must not rely on cookies",
        );
        assert(
          (await (await call("/api/session", undefined, token)).json())
            .authenticated === true,
        );
        assert(
          (await call(
            "/api/accounts",
            { name: "Staff-created", balance: 5 },
            token,
          )).status === 201,
        );
        const updated = await call(`/api/accounts/${id}/credits`, {
          delta: -1,
          requestId: crypto.randomUUID(),
        }, token);
        assert(updated.status === 200 && (await updated.json()).balance === 1);
        assert(
          (await call(`/api/accounts/${id}/credits`, {
            delta: 5,
            requestId: crypto.randomUUID(),
          }, token)).status === 400,
        );
        assert((await call("/api/accounts", null, token)).status === 400);
        const qr = await call(`/api/accounts/${id}/qr`);
        assert(
          qr.status === 200 &&
            qr.headers.get("content-type") === "image/svg+xml" &&
            (await qr.text()).includes("<svg"),
        );
        const sessions =
          await sql`SELECT token_hash FROM credit_cards.staff_sessions`;
        assert(sessions.every((r) => r.token_hash !== token));
      },
    );

    await t.step(
      "CORS permits the frontend origin and blocks other origins",
      async () => {
        const preflight = await handler(
          new Request("https://backend.example/api/accounts", {
            method: "OPTIONS",
            headers: {
              Origin: "https://example.github.io",
              "Access-Control-Request-Headers": "authorization,content-type",
              "Access-Control-Request-Method": "POST",
            },
          }),
        );
        assert(preflight.status === 204);
        assert(
          preflight.headers.get("access-control-allow-origin") ===
            "https://example.github.io",
        );
        assert(
          preflight.headers.get("access-control-allow-headers")!.includes(
            "Authorization",
          ),
        );
        const denied = await call(
          `/api/accounts/${id}/credits`,
          { delta: 1, requestId: crypto.randomUUID() },
          token,
          handler,
          "https://other.example",
        );
        assert(
          denied.status === 403 &&
            !denied.headers.has("access-control-allow-origin"),
        );
        assert((await store.get(id)).balance === 1);
      },
    );

    await t.step(
      "sessions survive API recreation, rotate with passwords, and revoke on logout",
      async () => {
        const restarted = createApi(sql, {
          publicUrl: "https://example.github.io/credit-cards/",
          staffPassword: "test-password",
        });
        assert(
          (await (await call("/api/session", undefined, token, restarted))
            .json()).authenticated === true,
        );
        const changed = createApi(sql, {
          publicUrl: "https://example.github.io/credit-cards/",
          staffPassword: "different-password",
        });
        assert(
          (await (await call("/api/session", undefined, token, changed)).json())
            .authenticated === false,
        );
        assert((await call("/api/logout", {}, token)).status === 200);
        assert(
          (await (await call("/api/session", undefined, token)).json())
            .authenticated === false,
        );
      },
    );

    await t.step(
      "session expiry, missing passwords and login rate limits are enforced",
      async () => {
        const session =
          await (await call("/api/login", { password: "test-password" }))
            .json();
        await sql`UPDATE credit_cards.staff_sessions SET expires_at = now() - interval '1 second'`;
        assert(
          (await (await call("/api/session", undefined, session.token)).json())
            .authenticated === false,
        );
        const disabled = createApi(sql, {
          publicUrl: "https://example.github.io/credit-cards/",
        });
        assert(
          (await call("/api/login", { password: "anything" }, "", disabled))
            .status === 503,
        );
        await sql`INSERT INTO credit_cards.login_attempts (window_start, attempts) VALUES (date_trunc('minute', now()), 30) ON CONFLICT (window_start) DO UPDATE SET attempts = 30`;
        assert(
          (await call("/api/login", { password: "wrong" })).status === 429,
        );
      },
    );
  } finally {
    await sql.end();
  }
});
