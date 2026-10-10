// `npm run scan -- https://example.com` scans one site and prints a summary.
// Add --agent to run the testing agent too (needs ANTHROPIC_API_KEY in .env).
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { agentModelFromEnv } from "./agent/model";
import { closeBrowser, scanSite } from "./scan";

// The worker's settings, for the key. Missing file: run without them.
try {
  process.loadEnvFile(".env");
} catch {
  // no worker/.env
}

const url = process.argv.find((a) => /^https?:\/\//.test(a));
const wantAgent = process.argv.includes("--agent");
if (!url) {
  console.error("Usage: npm run scan -- https://example.com [--agent]");
  process.exit(1);
}
const agent = wantAgent ? agentModelFromEnv() : null;
if (wantAgent && !agent) {
  console.error("--agent needs ANTHROPIC_API_KEY in worker/.env");
  process.exit(1);
}
const shotDir = path.join(tmpdir(), "legible-shots");
if (agent) mkdirSync(shotDir, { recursive: true });

const started = Date.now();
try {
  const raw = await scanSite(url, {
    onProgress: (d, t) => console.log(`page ${d} of ${t}`),
    ...(agent ? { agent, onShot: (id: string, jpeg: Buffer) => writeFileSync(path.join(shotDir, `${id}.jpg`), jpeg) } : {}),
  });
  const summary = raw.pages.map((p) => ({
    url: p.url,
    status: p.status,
    reason: p.reason,
    violations: p.violations.map((v) => `${v.id} (${v.impact}, ${v.nodeCount})`),
    checkByHand: p.incomplete.filter((v) => v.id.startsWith("legible-")).map((v) => `${v.id} (${v.nodeCount})`),
    agent: p.agent && { status: p.agent.status, reason: p.agent.reason, steps: p.agent.steps, reviews: p.agent.reviews.map((r) => `${r.kind} ${r.selector}: ${r.reason}`) },
  }));
  console.log(JSON.stringify({ seconds: (Date.now() - started) / 1000, engine: raw.engine, agent: raw.agent, shots: agent ? shotDir : undefined, pages: summary }, null, 2));
} catch (e) {
  console.error("Scan failed:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
