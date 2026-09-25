// A real Postgres server for local development and tests, run from npm
// binaries (no Docker needed). Production uses Supabase instead.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

export async function startLocalPostgres({ dir, port, database = "legible", persistent = true }) {
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent,
    onLog: () => {},
    onError: (e) => console.error(String(e).trim()),
  });
  if (!existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  const found = await client.query("select 1 from pg_database where datname = $1", [database]);
  if (!found.rowCount) await client.query(`create database ${database}`);
  await client.end();
  return { pg, url: `postgres://postgres:postgres@127.0.0.1:${port}/${database}` };
}
