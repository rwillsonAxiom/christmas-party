import { sessionPoolerUrl } from "./deploy-database.ts";

Deno.test("deployment selects the primary session pooler and strips credentials", () => {
  const config = [
    {
      database_type: "READ_REPLICA",
      connection_string:
        "postgres://postgres.example:secret@aws-1-replica.pooler.supabase.com:6543/postgres",
    },
    {
      database_type: "PRIMARY",
      connection_string:
        "postgres://postgres.other:secret@aws-1-other.pooler.supabase.com:6543/postgres",
    },
    {
      database_type: "PRIMARY",
      connection_string:
        "postgres://postgres.example:secret@aws-1-region.pooler.supabase.com:6543/postgres?password=secret&sslmode=disable",
    },
  ];
  const actual = sessionPoolerUrl(config, "example");
  const expected =
    "postgresql://postgres.example@aws-1-region.pooler.supabase.com:5432/postgres?sslmode=require";
  if (actual !== expected) throw new Error(`Unexpected pooler URL: ${actual}`);
});

Deno.test("deployment rejects missing, invalid and non-shared primary poolers", () => {
  for (
    const config of [
      null,
      [],
      [{ database_type: "PRIMARY", connection_string: "invalid" }],
      [{
        database_type: "PRIMARY",
        connection_string:
          "postgres://postgres.example@db.example.supabase.co/postgres",
      }],
      [{
        database_type: "PRIMARY",
        connection_string:
          "postgres://postgres.example@fake.pooler.supabase.com.evil.example/postgres",
      }],
    ]
  ) {
    let rejected = false;
    try {
      sessionPoolerUrl(config, "example");
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Accepted invalid pooler configuration.");
  }
});
