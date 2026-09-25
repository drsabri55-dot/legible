// Applies every file in supabase/migrations that has not run yet, in name
// order, each inside its own transaction. Used by `npm run db:migrate`, the
// local dev database and the test setup, so all three share one path.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

export async function applyMigrations(sql, log = console.log) {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const text = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    log(`applied ${file}`);
    applied++;
  }
  if (!applied) log("database is up to date");
  return applied;
}
