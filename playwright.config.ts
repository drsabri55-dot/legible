import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the whole product on separate ports: a fresh local
// Postgres, the scan worker, a production build of the site and a small
// fixture website with known accessibility faults. Payments use the
// development checkout and emails go to .data/outbox.
const WEB = 3100;
const WORKER = 4100;
const DB = 54331;
const FIXTURE = 5055;
const SECRET = "e2e-worker-secret-0123456789abcdef";

const siteEnv = {
  NEXT_DIST_DIR: ".next-e2e",
  APP_URL: `http://localhost:${WEB}`,
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${DB}/legible`,
  WORKER_URL: `http://localhost:${WORKER}`,
  WORKER_SECRET: SECRET,
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef-0123",
  CRON_SECRET: "e2e-cron-secret",
  ADMIN_EMAILS: "admin@legible.test",
  STRIPE_SECRET_KEY: "",
  RESEND_API_KEY: "",
  OWNER_EMAIL: "",
  ALLOW_FAKE_PAYMENTS: "true",
  ALLOW_PRIVATE_TARGETS: "1",
  NEXT_PUBLIC_ALLOW_PRIVATE_TARGETS: "1",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "node scripts/dev-db.mjs",
      port: DB,
      env: { LOCAL_PG_PORT: String(DB), LOCAL_PG_DIR: ".data/pg-e2e", LOCAL_PG_FRESH: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    { command: `node tests/fixtures/serve.mjs ${FIXTURE}`, port: FIXTURE, reuseExistingServer: false },
    {
      command: "npm --prefix worker start",
      url: `http://localhost:${WORKER}/health`,
      env: { WORKER_PORT: String(WORKER), WORKER_SECRET: SECRET, APP_URL: `http://localhost:${WEB}`, ALLOW_PRIVATE_TARGETS: "1" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next build && npx next start -p ${WEB}`,
      url: `http://localhost:${WEB}/terms`,
      env: siteEnv,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
