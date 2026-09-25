// Starts a throwaway Postgres for the database tests and applies the real
// migrations to it, so the SQL in supabase/migrations is tested too.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import type { TestProject } from "vitest/node";
import { startLocalPostgres } from "../../scripts/lib/local-postgres.mjs";
import { applyMigrations } from "../../scripts/lib/migrations.mjs";

export default async function setup(project: TestProject) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "legible-test-pg-"));
  const port = 54400 + Math.floor(Math.random() * 400);
  const { pg, url } = await startLocalPostgres({ dir, port, database: "legible_test", persistent: false });
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await applyMigrations(sql, () => {});
  await sql.end();
  project.provide("databaseUrl", url);
  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
