// One scan job: runs the scan and sends its messages to the site. The site
// charges the agent's spend from these messages against its daily cap.
import { emptyUsage, meter, type AgentModel } from "./agent/model";
import { crawlSite, type CrawlOptions, type CrawlReason } from "./crawl";
import { ScanError, scanSite, type ScanOptions } from "./scan";
import type { AgentUsage, RawPage, RawScan } from "./types";

export interface JobOptions {
  // The testing agent's model, or null when the site did not ask for it.
  model: AgentModel | null;
  // Sends one message to the site; resolves with the site's answer, if any.
  send: (message: unknown) => Promise<unknown>;
  scan?: (url: string, opts: ScanOptions) => Promise<RawScan>;
}

export async function runScanJob(url: string, opts: JobOptions): Promise<void> {
  const metered = opts.model ? meter(opts.model) : null;
  const agent = metered?.model;
  const scan = opts.scan ?? scanSite;
  const started = Date.now();
  const host = new URL(url).host;
  try {
    const shots: { id: string; data: string }[] = [];
    const raw = await scan(url, {
      onProgress: async (done, total) => void (await opts.send({ type: "progress", pagesDone: done, pagesTotal: total })),
      ...(agent ? { agent, onShot: (id: string, jpeg: Buffer) => void shots.push({ id, data: jpeg.toString("base64") }) } : {}),
    });
    // Screenshots go first, in batches small enough for one request each.
    await sendShots(shots, opts.send);
    // Every call the agent made, including pages the scan later dropped.
    if (raw.agent && metered) raw.agent.usage = metered.total();
    await opts.send({ type: "complete", raw });
    console.log(`[scan] ${host} done in ${Date.now() - started} ms${agent ? " with the agent" : ""}`);
  } catch (e) {
    const code = e instanceof ScanError ? e.code : "error";
    console.warn(`[scan] ${host} failed: ${(e as Error).message}`);
    await opts.send({
      type: "failed",
      error: code,
      detail: String((e as Error).message).slice(0, 300),
      // What the agent spent before the scan failed, so the site can charge it.
      ...(metered ? { agent: { model: metered.model.name, usage: metered.total() } } : {}),
    });
  }
}

type Shot = { id: string; data: string };

async function sendShots(shots: Shot[], send: JobOptions["send"]): Promise<void> {
  let batch: Shot[] = [];
  let size = 0;
  for (const s of shots) {
    if (batch.length && size + s.data.length > 900_000) {
      await send({ type: "shots", shots: batch });
      batch = [];
      size = 0;
    }
    batch.push(s);
    size += s.data.length;
  }
  if (batch.length) await send({ type: "shots", shots: batch });
}

function minus(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens - b.inputTokens,
    outputTokens: a.outputTokens - b.outputTokens,
    cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens - b.cacheWriteTokens,
  };
}

const PAGE_BYTES = 900_000;

// One page in one message: example elements are dropped (never the counts)
// until it fits.
export function fitPage(page: RawPage): RawPage {
  for (const keep of [25, 10, 5, 2, 1]) {
    for (const rule of page.violations) rule.nodes = rule.nodes.slice(0, keep);
    for (const rule of page.incomplete) rule.nodes = rule.nodes.slice(0, Math.min(keep, 3));
    if (Buffer.byteLength(JSON.stringify(page)) <= PAGE_BYTES) break;
  }
  return page;
}

export interface FullJobOptions {
  model: AgentModel | null;
  send: JobOptions["send"];
  // Addresses tested before, pages in all, and AI fixes left for the report.
  done: string[];
  maxPages: number;
  fixesLeft: number;
  crawl?: (url: string, opts: CrawlOptions) => Promise<{ tested: number; reason: CrawlReason }>;
}

// The paid whole-site test. Each page goes to the site as soon as it is
// tested, with what the agent used for it, so a restart loses nothing stored
// and the site can stop the run at its spending limit.
export async function runFullJob(url: string, opts: FullJobOptions): Promise<void> {
  const metered = opts.model ? meter(opts.model) : null;
  const crawl = opts.crawl ?? crawlSite;
  let charged = emptyUsage();
  let tested = 0;
  const spend = () => {
    if (!metered) return {};
    const total = metered.total();
    const usage = minus(total, charged);
    charged = total;
    return { agent: { model: metered.model.name, usage } };
  };
  const host = new URL(url).host;
  const started = Date.now();
  try {
    let shots: Shot[] = [];
    const result = await crawl(url, {
      done: opts.done,
      maxPages: opts.maxPages,
      ...(metered ? { agent: metered.model, fixBudget: { left: opts.fixesLeft } } : {}),
      onShot: (id: string, jpeg: Buffer) => void shots.push({ id, data: jpeg.toString("base64") }),
      onPage: async (page) => {
        await sendShots(shots, opts.send);
        shots = [];
        tested++;
        const answer = (await opts.send({ type: "page", page: fitPage(page), ...spend() })) as { stop?: unknown } | null;
        return { stop: answer?.stop === true };
      },
    });
    await opts.send({ type: "done", reason: result.reason, tested: result.tested, ...leftover(spend()) });
    console.log(`[full] ${host}: ${result.tested} pages, ${result.reason}, in ${Date.now() - started} ms`);
  } catch (e) {
    console.warn(`[full] ${host} failed: ${(e as Error).message}`);
    await opts.send({ type: "done", reason: "error", tested, ...leftover(spend()) });
  }
}

// What the agent used after the last page, sent with the end of the run.
function leftover(s: { agent?: { model: string; usage: AgentUsage } }) {
  const u = s.agent?.usage;
  return u && (u.inputTokens || u.outputTokens || u.cacheReadTokens || u.cacheWriteTokens) ? s : {};
}
