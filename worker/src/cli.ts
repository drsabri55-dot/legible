// `npm run scan -- https://example.com` scans one site and prints a summary.
import { closeBrowser, scanSite } from "./scan";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run scan -- https://example.com");
  process.exit(1);
}

const started = Date.now();
try {
  const raw = await scanSite(url, { onProgress: (d, t) => console.log(`page ${d} of ${t}`) });
  const summary = raw.pages.map((p) => ({
    url: p.url,
    status: p.status,
    reason: p.reason,
    violations: p.violations.map((v) => `${v.id} (${v.impact}, ${v.nodeCount})`),
  }));
  console.log(JSON.stringify({ seconds: (Date.now() - started) / 1000, engine: raw.engine, pages: summary }, null, 2));
} catch (e) {
  console.error("Scan failed:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
