// `npm run db:migrate` — applies pending migrations to DATABASE_URL.
// Use this against Supabase with the connection string from
// Project Settings → Database (session pooler, port 5432).
import postgres from "postgres";
import { applyMigrations } from "./lib/migrations.mjs";

// Picks up DATABASE_URL from .env.local when it is not already set.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local: rely on the environment
  }
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await applyMigrations(sql);
} finally {
  await sql.end();
}
