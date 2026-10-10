// One scan job: runs the scan and sends its messages to the site. The site
// charges the agent's spend from these messages against its daily cap.
import { meter, type AgentModel } from "./agent/model";
import { ScanError, scanSite, type ScanOptions } from "./scan";
import type { RawScan } from "./types";

export interface JobOptions {
  // The testing agent's model, or null when the site did not ask for it.
  model: AgentModel | null;
  send: (message: unknown) => Promise<void>;
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
      onProgress: (done, total) => opts.send({ type: "progress", pagesDone: done, pagesTotal: total }),
      ...(agent ? { agent, onShot: (id: string, jpeg: Buffer) => void shots.push({ id, data: jpeg.toString("base64") }) } : {}),
    });
    // Screenshots go first, in batches small enough for one request each.
    let batch: typeof shots = [];
    let size = 0;
    for (const s of shots) {
      if (batch.length && size + s.data.length > 900_000) {
        await opts.send({ type: "shots", shots: batch });
        batch = [];
        size = 0;
      }
      batch.push(s);
      size += s.data.length;
    }
    if (batch.length) await opts.send({ type: "shots", shots: batch });
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
