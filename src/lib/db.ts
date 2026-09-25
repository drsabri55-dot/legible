import "server-only";
import postgres from "postgres";
import { env } from "./env";

// One pool per server process. The global keeps hot reload in development
// from opening a new pool on every edit.
const g = globalThis as unknown as { __legibleSql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!g.__legibleSql) {
    const url = env.databaseUrl();
    g.__legibleSql = postgres(url, {
      // Supabase's transaction pooler (port 6543) does not support prepared
      // statements. Harmless elsewhere.
      prepare: false,
      max: process.env.VERCEL ? 3 : 10,
      idle_timeout: 20,
      onnotice: () => {},
    });
  }
  return g.__legibleSql;
}
