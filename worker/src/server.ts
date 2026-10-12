import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { agentModelFromEnv } from "./agent/model";
import { runFullJob, runScanJob } from "./job";
import { allowPrivateTargets } from "./net";
import { printPdf } from "./pdf";
import { JobQueue } from "./queue";
import { closeBrowser } from "./scan";

// WORKER_PORT wins over PORT so a PORT meant for the site (set by some dev
// tools) cannot pull the worker onto the same port. Hosts like Railway set
// PORT only, which is used as normal.
const PORT = Number(process.env.WORKER_PORT || process.env.PORT || 4000);
const SECRET = process.env.WORKER_SECRET || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const CONCURRENCY = Math.max(1, Number(process.env.MAX_CONCURRENT_SCANS || 2));

if (!SECRET || SECRET.length < 16) {
  console.error("WORKER_SECRET must be set (16+ characters).");
  process.exit(1);
}
if (!APP_URL) {
  console.error("APP_URL must be set to the site's address.");
  process.exit(1);
}
if (allowPrivateTargets()) console.warn("ALLOW_PRIVATE_TARGETS is on. Never use this in production.");

const queue = new JobQueue(CONCURRENCY, 20);
// Paid whole-site tests run one at a time in their own queue, so a long run
// never holds up free scans.
const fullQueue = new JobQueue(1, 10);
const ALIVE_MS = 5 * 60_000;
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

function authorised(req: Request, res: Response, next: NextFunction) {
  const header = req.get("authorization") || "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    res.status(401).json({ error: "unauthorised" });
    return;
  }
  next();
}

function httpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

// Sends one message to the site and returns its answer (null when there is none).
async function callback(url: string, body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return await res.json().catch(() => null);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
      console.warn(`[callback] ${url} answered ${res.status}`);
    } catch (e) {
      console.warn(`[callback] ${url} failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  console.error(`[callback] gave up on ${url}`);
  return null;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, ...queue.stats, full: fullQueue.stats });
});

app.post("/jobs/scan", authorised, (req, res) => {
  const { scanId, url, callbackUrl } = req.body || {};
  if (typeof scanId !== "string" || typeof url !== "string" || typeof callbackUrl !== "string") {
    res.status(400).json({ error: "scanId, url and callbackUrl are required" });
    return;
  }
  let target: URL;
  let cb: URL;
  try {
    target = new URL(url);
    cb = new URL(callbackUrl);
  } catch {
    res.status(400).json({ error: "invalid url" });
    return;
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    res.status(400).json({ error: "invalid url" });
    return;
  }
  if (cb.origin !== new URL(APP_URL).origin) {
    res.status(400).json({ error: "callbackUrl must be on APP_URL" });
    return;
  }

  // Only when the site asks and a key is set. The site asks while its daily
  // spending cap allows.
  const model = req.body?.agent === true ? agentModelFromEnv() : null;
  const accepted = queue.push(() =>
    runScanJob(target.toString(), { model, send: (message) => callback(cb.toString(), message) }),
  );
  if (!accepted) {
    res.status(503).json({ error: "queue full" });
    return;
  }
  res.status(202).json({ queued: true, ...queue.stats });
});

app.post("/jobs/full", authorised, (req, res) => {
  const { scanId, url, callbackUrl, done, maxPages, fixesLeft } = req.body || {};
  const target = httpUrl(url);
  const cb = httpUrl(callbackUrl);
  const list = Array.isArray(done) ? done.filter((d: unknown): d is string => typeof d === "string").slice(0, 100) : null;
  if (typeof scanId !== "string" || !target || !cb || !list || !Number.isInteger(maxPages) || !Number.isInteger(fixesLeft)) {
    res.status(400).json({ error: "scanId, url, callbackUrl, done, maxPages and fixesLeft are required" });
    return;
  }
  if (cb.origin !== new URL(APP_URL).origin) {
    res.status(400).json({ error: "callbackUrl must be on APP_URL" });
    return;
  }
  const model = req.body?.agent === true ? agentModelFromEnv() : null;
  const attempt = Number.isInteger(req.body?.attempt) ? (req.body.attempt as number) : undefined;
  // Says the run is alive every few minutes, while it waits in the queue and
  // while it works, so the site never mistakes a long wait for a lost run. The
  // site's answer can end it (it was replaced, or the test is over).
  const run = { stopped: false };
  const beat = setInterval(async () => {
    const answer = (await callback(cb.toString(), { type: "alive", attempt })) as { stop?: unknown } | null;
    if (answer?.stop === true) run.stopped = true;
  }, ALIVE_MS);
  const accepted = fullQueue.push(async () => {
    try {
      await runFullJob(target.toString(), {
        model,
        done: list,
        maxPages: Math.min(50, Math.max(1, maxPages)),
        fixesLeft: Math.min(300, Math.max(0, fixesLeft)),
        attempt,
        shouldStop: () => run.stopped,
        send: (message) => callback(cb.toString(), message),
      });
    } finally {
      clearInterval(beat);
    }
  });
  if (!accepted) {
    clearInterval(beat);
    res.status(503).json({ error: "queue full" });
    return;
  }
  res.status(202).json({ queued: true, ...fullQueue.stats });
});

app.post("/pdf", authorised, async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }
  try {
    const pdf = await printPdf(url, APP_URL);
    res.setHeader("content-type", "application/pdf");
    res.send(pdf);
  } catch (e) {
    console.error("[pdf]", e);
    res.status(502).json({ error: (e as Error).message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Legible worker listening on http://localhost:${PORT} (up to ${CONCURRENCY} scans at once)`);
});

async function shutdown() {
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
