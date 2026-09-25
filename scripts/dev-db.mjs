// `npm run db:start` — runs the local Postgres on port 54329 and applies the
// migrations. Data lives in .data/pg and survives restarts. Ctrl+C stops it.
// LOCAL_PG_PORT, LOCAL_PG_DIR and LOCAL_PG_FRESH=1 are used by the tests.
import { rmSync } from "node:fs";
import postgres from "postgres";
import path from "node:path";
import { startLocalPostgres } from "./lib/local-postgres.mjs";
import { applyMigrations } from "./lib/migrations.mjs";

const port = Number(process.env.LOCAL_PG_PORT || 54329);
const dir = path.resolve(process.env.LOCAL_PG_DIR || ".data/pg");
// The end-to-end tests start from an empty database every run.
if (process.env.LOCAL_PG_FRESH === "1") rmSync(dir, { recursive: true, force: true });
const { pg, url } = await startLocalPostgres({ dir, port });
const sql = postgres(url, { onnotice: () => {} });
await applyMigrations(sql);
await sql.end();
console.log(`local Postgres ready at ${url}`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
