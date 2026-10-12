// The paid whole-site test: walks the site breadth first from the start
// address and tests each new page (axe-core, the agent and fixes), with the
// free scan's rules for what to skip, robots.txt and a pause between pages.
// Pages tested before (by the free scan, or an earlier run of this test) are
// only loaded for their links.
import { AI_FIXES_PER_SCAN } from "./fixes/ai";
import {
  PAUSE_BETWEEN_PAGES_MS,
  linksOf,
  openSite,
  pageKey,
  sameSite,
  scanPage,
  userAgent,
  type ScanOptions,
} from "./scan";
import type { RawPage } from "./types";

export interface CrawlOptions extends Omit<ScanOptions, "onProgress"> {
  // Addresses already tested: never tested again.
  done: string[];
  // Pages in all, counting `done`.
  maxPages: number;
  // Called with each newly tested page; `stop` ends the crawl (the site's
  // spending limit for the report).
  onPage: (page: RawPage) => Promise<{ stop: boolean }>;
}

export type CrawlReason = "done" | "limit" | "stopped";

function keyOf(url: string): string | null {
  try {
    return pageKey(new URL(url));
  } catch {
    return null;
  }
}

export async function crawlSite(startUrl: string, opts: CrawlOptions): Promise<{ tested: number; reason: CrawlReason }> {
  if (opts.agent && !opts.fixBudget) opts = { ...opts, fixBudget: { left: AI_FIXES_PER_SCAN } };
  const { start, robots, context } = await openSite(startUrl, userAgent());
  const tested = new Set<string>(opts.done.map(keyOf).filter((k): k is string => !!k));
  const queued = new Set<string>([pageKey(start)]);
  const signatures = new Set<string>();
  const queue = [start.toString()];
  const pause = Math.max(opts.pauseMs ?? PAUSE_BETWEEN_PAGES_MS, robots.crawlDelayMs);
  let host: string | null = null;
  let count = 0;
  let loads = 0;

  const enqueue = (links: string[]) => {
    for (const link of links) {
      const k = keyOf(link);
      if (!k || queued.has(k)) continue;
      queued.add(k);
      queue.push(link);
    }
  };

  try {
    while (queue.length) {
      if (opts.done.length + count >= opts.maxPages) return { tested: count, reason: "limit" };
      // A broken site is not hammered: at most three loads for each page allowed.
      if (loads >= opts.maxPages * 3) break;
      const url = queue.shift()!;
      if (!robots.isAllowed(url)) continue;
      if (loads > 0) await new Promise((r) => setTimeout(r, pause));
      loads++;

      if (tested.has(keyOf(url) ?? "")) {
        const seen = await linksOf(context, url);
        if (!seen) continue;
        host ??= new URL(seen.finalUrl).hostname;
        if (seen.signature) signatures.add(seen.signature);
        enqueue(seen.links);
        continue;
      }

      let result;
      try {
        result = await scanPage(
          context,
          url,
          false,
          opts,
          (landedUrl, signature) => {
            const landed = new URL(landedUrl);
            return (
              sameSite(landed.hostname, host ?? start.hostname) &&
              !tested.has(pageKey(landed)) &&
              !(signature && signatures.has(signature))
            );
          },
          true,
        );
      } catch {
        continue; // a page that fails is skipped
      }
      const landed = new URL(result.finalUrl);
      host ??= landed.hostname;
      if (!sameSite(landed.hostname, host)) continue; // redirected to another website
      const key = pageKey(landed);
      if (tested.has(key)) {
        enqueue(result.links); // a page tested before, by another address
        continue;
      }
      if (result.signature && signatures.has(result.signature)) continue;
      tested.add(key);
      if (result.signature) signatures.add(result.signature);
      enqueue(result.links);
      count++;
      const answer = await opts.onPage(result.raw);
      if (answer.stop) return { tested: count, reason: "stopped" };
    }
    return { tested: count, reason: opts.done.length + count >= opts.maxPages ? "limit" : "done" };
  } finally {
    await context.close().catch(() => {});
  }
}
