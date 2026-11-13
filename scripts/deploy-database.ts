// Discover the free shared pooler instead of relying on CLI link's IPv6 fallback.
// The password is supplied separately to the CLI through PGPASSWORD.
export function sessionPoolerUrl(config: unknown, projectRef: string): string {
  if (!Array.isArray(config)) throw new Error("Invalid pooler configuration.");
  for (const entry of config) {
    if (entry?.database_type !== "PRIMARY") continue;
    let source: URL;
    try {
      source = new URL(entry.connection_string ?? entry.connectionString);
    } catch {
      continue;
    }
    if (
      !["postgres:", "postgresql:"].includes(source.protocol) ||
      !source.hostname.endsWith(".pooler.supabase.com") ||
      decodeURIComponent(source.username) !== `postgres.${projectRef}`
    ) continue;
    // Rebuild rather than copy: never forward API passwords or query parameters.
    const url = new URL(`postgresql://${source.hostname}:5432/postgres`);
    url.username = `postgres.${projectRef}`;
    url.searchParams.set("sslmode", "require");
    return url.href;
  }
  throw new Error(
    "No primary shared pooler found. Check that the project is running.",
  );
}

if (import.meta.main) {
  const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
  const projectRef = Deno.env.get("SUPABASE_PROJECT_REF");
  const output = Deno.env.get("GITHUB_OUTPUT");
  if (!token || !projectRef || !output || !/^[a-z0-9]+$/.test(projectRef)) {
    throw new Error("Missing or invalid deployment environment settings.");
  }
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    // Do not log the response body: configuration responses can contain secrets.
    await response.body?.cancel();
    if (response.status === 403) {
      throw new Error(
        "Grant Connection Pooling: Read for this project and update SUPABASE_ACCESS_TOKEN in GitHub.",
      );
    }
    if (response.status === 401) {
      throw new Error(
        "SUPABASE_ACCESS_TOKEN is invalid or expired. Replace the GitHub secret.",
      );
    }
    throw new Error(
      `Pooler discovery failed (HTTP ${response.status}). Check project availability and reference.`,
    );
  }
  const url = sessionPoolerUrl(await response.json(), projectRef);
  await Deno.writeTextFile(output, `url=${url}\n`, { append: true });
  console.log("Using the primary shared session pooler over IPv4 (port 5432).");
}
