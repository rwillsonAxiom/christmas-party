import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectDatabase,
  type Sql,
} from "../supabase/functions/_shared/database.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(root, "data");
const cluster = join(data, "dev-postgres");
const log = join(data, "dev-postgres.log");
const username = "credit_cards_dev";
const decoder = new TextDecoder();

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function tool(name: string): Promise<string> {
  const suffix = Deno.build.os === "windows" ? ".exe" : "";
  const configured = Deno.env.get("POSTGRES_BIN");
  if (configured) return join(configured, name + suffix);
  try {
    if (
      (await new Deno.Command(name, {
        args: ["--version"],
        stdout: "null",
        stderr: "null",
      }).output()).success
    ) return name;
  } catch { /* Try the standard Windows installation directory. */ }
  if (Deno.build.os === "windows") {
    const installs = join(
      Deno.env.get("ProgramFiles") ?? "C:\\Program Files",
      "PostgreSQL",
    );
    if (await exists(installs)) {
      const versions = [];
      for await (const entry of Deno.readDir(installs)) {
        if (entry.isDirectory) versions.push(entry.name);
      }
      for (
        const version of versions.sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true })
        )
      ) {
        const candidate = join(installs, version, "bin", name + suffix);
        if (await exists(candidate)) return candidate;
      }
    }
  }
  throw new Error(
    `PostgreSQL tool '${name}' was not found. Install PostgreSQL server tools and add its bin directory to PATH, or set POSTGRES_BIN.`,
  );
}

async function run(
  command: string,
  args: string[],
  required = true,
  background = false,
) {
  const result = await new Deno.Command(command, {
    args,
    // PostgreSQL can inherit pg_ctl's pipe handles on Windows. Its output is
    // already redirected with -l, so don't wait for pipes held by the server.
    stdout: background ? "null" : "piped",
    stderr: background ? "null" : "piped",
  }).output();
  if (required && !result.success) {
    if (background) throw new Error(`${command} failed. See ${log}.`);
    throw new Error(
      `${command} failed:\n${decoder.decode(result.stderr)}\n${
        decoder.decode(result.stdout)
      }\nPostgreSQL log: ${log}`,
    );
  }
  return result;
}

function databasePort(): number {
  const port = Number(Deno.env.get("DEV_DATABASE_PORT") ?? "15433");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      "DEV_DATABASE_PORT must be an integer between 1024 and 65535.",
    );
  }
  return port;
}

async function checkRunningPort(port: number) {
  const lines = (await Deno.readTextFile(join(cluster, "postmaster.pid")))
    .split(/\r?\n/);
  if (Number(lines[3]) !== port) {
    throw new Error(
      `This workspace's PostgreSQL is already running on port ${
        lines[3]
      }. Run deno task dev:stop before changing DEV_DATABASE_PORT.`,
    );
  }
}

async function migrate(sql: Sql) {
  await sql.begin(async (tx) => {
    // Serialize migration startup, including its tracking-table creation.
    await tx`SELECT pg_advisory_xact_lock(731204832)`;
    await tx`SET LOCAL client_min_messages TO warning`;
    await tx`CREATE TABLE IF NOT EXISTS public.credit_cards_local_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    const files: string[] = [];
    for await (
      const entry of Deno.readDir(join(root, "supabase", "migrations"))
    ) {
      if (entry.isFile && /^\d{14}_[a-z0-9_]+\.sql$/.test(entry.name)) {
        files.push(entry.name);
      }
    }
    for (const name of files.sort()) {
      const source = await Deno.readTextFile(
        join(root, "supabase", "migrations", name),
      );
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
      );
      const checksum = Array.from(
        digest,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const applied = await tx<
        { checksum: string }[]
      >`SELECT checksum FROM public.credit_cards_local_migrations WHERE name = ${name}`;
      if (applied.length) {
        if (applied[0].checksum !== checksum) {
          throw new Error(
            `Applied migration ${name} has changed. Add a new migration instead of editing an applied one.`,
          );
        }
        continue;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO public.credit_cards_local_migrations (name, checksum) VALUES (${name}, ${checksum})`;
      console.log(`Applied local migration: ${name}`);
    }
  });
}

export async function prepareLocalDatabase(): Promise<
  { url: string; testUrl: string }
> {
  const port = databasePort();
  await Deno.mkdir(data, { recursive: true });
  const pgCtl = await tool("pg_ctl");
  if (!await exists(join(cluster, "PG_VERSION"))) {
    console.log("Creating this workspace's local PostgreSQL cluster…");
    // Trust authentication is confined to this loopback-only development cluster.
    await run(await tool("initdb"), [
      "-D",
      cluster,
      "-U",
      username,
      "--auth-local=trust",
      "--auth-host=trust",
      "--encoding=UTF8",
      "--no-locale",
    ]);
  }
  const status = await run(pgCtl, ["-D", cluster, "status"], false);
  if (!status.success) {
    const started = await run(
      pgCtl,
      [
        "-D",
        cluster,
        "-l",
        log,
        "-o",
        `-h 127.0.0.1 -p ${port}`,
        "-w",
        "-t",
        "20",
        "start",
      ],
      false,
      true,
    );
    if (
      !started.success &&
      !(await run(pgCtl, ["-D", cluster, "status"], false)).success
    ) {
      throw new Error(
        `Local PostgreSQL could not start on port ${port}. Check ${log}. If the port is in use, set DEV_DATABASE_PORT to a free port.`,
      );
    }
  }
  await checkRunningPort(port);
  const base = `postgresql://${username}@127.0.0.1:${port}`;
  const admin = connectDatabase(`${base}/postgres`);
  try {
    for (const name of ["credit_cards_dev", "credit_cards_test"]) {
      if (
        !(await admin`SELECT datname FROM pg_database WHERE datname = ${name}`)
          .length
      ) {
        // Fixed, application-owned names; never supplied from an environment URL.
        await admin.unsafe(`CREATE DATABASE "${name}"`);
      }
    }
  } finally {
    await admin.end();
  }
  const url = `${base}/credit_cards_dev`;
  const sql = connectDatabase(url);
  try {
    await migrate(sql);
  } finally {
    await sql.end();
  }
  console.log(`Local PostgreSQL ready: 127.0.0.1:${port}/credit_cards_dev`);
  return { url, testUrl: `${base}/credit_cards_test` };
}

export async function stopLocalDatabase(): Promise<void> {
  if (!await exists(join(cluster, "PG_VERSION"))) return;
  const pgCtl = await tool("pg_ctl");
  if ((await run(pgCtl, ["-D", cluster, "status"], false)).success) {
    await run(pgCtl, ["-D", cluster, "stop", "-m", "fast", "-w", "-t", "20"]);
    console.log("Stopped this workspace's PostgreSQL. Local data is retained.");
  }
}

if (import.meta.main) {
  if (Deno.args[0] === "stop") await stopLocalDatabase();
  else await prepareLocalDatabase();
}
