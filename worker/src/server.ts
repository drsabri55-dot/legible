import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { agentModelFromEnv } from "./agent/model";
import { runScanJob } from "./job";
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

async function callback(url: string, body: unknown): Promise<void> {
  const payload = JSON.stringify(body);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return;
      console.warn(`[callback] ${url} answered ${res.status}`);
    } catch (e) {
      console.warn(`[callback] ${url} failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  console.error(`[callback] gave up on ${url}`);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, ...queue.stats });
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
