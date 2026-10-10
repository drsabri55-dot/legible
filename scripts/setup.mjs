// `npm run setup` — one-time local setup. Creates .env.local and worker/.env
// with working development values (random secrets included), installs the
// worker's packages and the Chromium browser it uses. Safe to run again: it
// never overwrites a file that already exists.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const secret = () => randomBytes(32).toString("hex");
const workerSecret = secret();

if (!existsSync(".env.local")) {
  writeFileSync(
    ".env.local",
    `APP_URL=http://localhost:3000
SESSION_SECRET=${secret()}
ADMIN_EMAILS=owner@example.com
OWNER_EMAIL=
CONTACT_EMAIL=hello@example.com
COMPANY_ADDRESS=Legible
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/legible
WORKER_URL=http://localhost:4000
WORKER_SECRET=${workerSecret}
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
REPORT_PRICE_CENTS=9900
RESEND_API_KEY=
EMAIL_FROM="Legible <reports@example.com>"
CRON_SECRET=${secret()}
ALLOW_FAKE_PAYMENTS=true
# Testing agent: paste the prices per million tokens from the Anthropic pricing page.
# AGENT_PRICE_INPUT_PER_MTOK=
# AGENT_PRICE_OUTPUT_PER_MTOK=
# AGENT_DAILY_CAP_USD=10
`,
  );
  console.log("created .env.local");
} else {
  console.log(".env.local exists, left as it is");
}

if (!existsSync("worker/.env")) {
  const match = /^WORKER_SECRET=(.*)$/m.exec(readFileSync(".env.local", "utf8"));
  writeFileSync(
    "worker/.env",
    `WORKER_PORT=4000
WORKER_SECRET=${match ? match[1] : workerSecret}
APP_URL=http://localhost:3000
MAX_CONCURRENT_SCANS=2
# ANTHROPIC_API_KEY=   (paste your own key here to run the testing agent)
`,
  );
  console.log("created worker/.env");
}

execSync("npm install", { cwd: "worker", stdio: "inherit" });
execSync("npx playwright install chromium", { cwd: "worker", stdio: "inherit" });
console.log("\nSetup done. Start everything with: npm run dev");
