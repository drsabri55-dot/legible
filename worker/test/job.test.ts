// The job the worker runs for each scan: what it sends back to the site,
// above all the agent's spend, which the site charges against its daily cap.
import { describe, expect, it } from "vitest";
import { runFullJob, runScanJob } from "../src/job";
import { ReplayModel } from "../src/agent/model";
import { ScanError, type ScanOptions } from "../src/scan";
import type { RawScan } from "../src/types";

const raw = (): RawScan => ({
  version: 1,
  startUrl: "https://a.example/",
  finalUrl: "https://a.example/",
  engine: { axe: "4", userAgent: "ua" },
  startedAt: "2026-10-11T00:00:00Z",
  finishedAt: "2026-10-11T00:00:01Z",
  pages: [],
});

describe("runScanJob", () => {
  it("reports every model call the scan made, including ones whose page was dropped", async () => {
    const sent: { type: string; raw?: RawScan }[] = [];
    await runScanJob("https://a.example/", {
      model: new ReplayModel([{ text: "a" }, { text: "b" }]),
      send: async (m) => void sent.push(m as never),
      scan: async (_url: string, opts: ScanOptions) => {
        // Two calls; the scan keeps the usage of only one page.
        await opts.agent!.turn({ system: "", tools: [], messages: [] });
        await opts.agent!.turn({ system: "", tools: [], messages: [] });
        return { ...raw(), agent: { model: "replay", usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } } };
      },
    });
    const done = sent.find((m) => m.type === "complete");
    expect(done?.raw?.agent?.usage).toEqual({ inputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("sends what the agent spent when the scan fails", async () => {
    const sent: Record<string, unknown>[] = [];
    await runScanJob("https://a.example/", {
      model: new ReplayModel([{ text: "a" }]),
      send: async (m) => void sent.push(m as never),
      scan: async (_url: string, opts: ScanOptions) => {
        await opts.agent!.turn({ system: "", tools: [], messages: [] });
        throw new ScanError("timeout", "too slow");
      },
    });
    expect(sent).toEqual([
      {
        type: "failed",
        error: "timeout",
        detail: "timeout: too slow",
        agent: { model: "replay", usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      },
    ]);
  });

  it("sends no agent fields when the agent was not asked for", async () => {
    const sent: Record<string, unknown>[] = [];
    await runScanJob("https://a.example/", {
      model: null,
      send: async (m) => void sent.push(m as never),
      scan: async (_url: string, opts: ScanOptions) => {
        expect(opts.agent).toBeUndefined();
        throw new ScanError("robots");
      },
    });
    expect(sent[0]).not.toHaveProperty("agent");
  });
});

describe("runFullJob", () => {
  const page = (url: string) => ({ url, status: "scanned" as const, violations: [], incomplete: [], passes: [], inapplicable: [] });

  it("sends each page with the AI usage since the page before, and passes the site's stop back", async () => {
    const sent: Record<string, unknown>[] = [];
    let stops = 0;
    await runFullJob("https://a.example/", {
      model: new ReplayModel([{ text: "a" }, { text: "b" }, { text: "c" }]),
      done: ["https://a.example/"],
      maxPages: 50,
      fixesLeft: 300,
      send: async (m) => {
        sent.push(m as Record<string, unknown>);
        return (m as { type: string }).type === "page" && sent.filter((x) => x.type === "page").length === 2 ? { stop: true } : { ok: true };
      },
      crawl: async (_url, opts) => {
        expect(opts.done).toEqual(["https://a.example/"]);
        expect(opts.fixBudget).toEqual({ left: 300 });
        await opts.agent!.turn({ system: "", tools: [], messages: [] });
        if ((await opts.onPage(page("https://a.example/1"))).stop) stops++;
        await opts.agent!.turn({ system: "", tools: [], messages: [] });
        await opts.agent!.turn({ system: "", tools: [], messages: [] });
        if ((await opts.onPage(page("https://a.example/2"))).stop) stops++;
        return { tested: 2, reason: "stopped" };
      },
    });
    const pages = sent.filter((m) => m.type === "page") as { page: { url: string }; agent: { usage: unknown } }[];
    expect(pages.map((p) => p.page.url)).toEqual(["https://a.example/1", "https://a.example/2"]);
    expect(pages.map((p) => p.agent.usage)).toEqual([
      { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { inputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ]);
    expect(stops).toBe(1);
    expect(sent[sent.length - 1]).toMatchObject({ type: "done", reason: "stopped", tested: 2 });
  });

  it("still says it is done when the crawl fails, with what it used after the last page", async () => {
    const sent: Record<string, unknown>[] = [];
    await runFullJob("https://a.example/", {
      model: new ReplayModel([{ text: "a" }]),
      done: [],
      maxPages: 50,
      fixesLeft: 10,
      send: async (m) => void sent.push(m as Record<string, unknown>),
      crawl: async (_url, opts) => {
        await opts.agent!.turn({ system: "", tools: [], messages: [] });
        throw new Error("browser crashed");
      },
    });
    expect(sent).toEqual([
      { type: "done", reason: "error", tested: 0, agent: { model: "replay", usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    ]);
  });
});

describe("runFullJob and its run number", () => {
  const page = (url: string) => ({ url, status: "scanned" as const, violations: [], incomplete: [], passes: [], inapplicable: [] });

  it("sends the run's number with every message, and stops when told to", async () => {
    const sent: Record<string, unknown>[] = [];
    let stopNow = false;
    await runFullJob("https://a.example/", {
      model: null,
      done: [],
      maxPages: 50,
      fixesLeft: 0,
      attempt: 2,
      shouldStop: () => stopNow,
      send: async (m) => void sent.push(m as Record<string, unknown>),
      crawl: async (_url, opts) => {
        const first = await opts.onPage(page("https://a.example/1"));
        stopNow = true;
        const second = await opts.onPage(page("https://a.example/2"));
        expect([first.stop, second.stop]).toEqual([false, true]);
        return { tested: 2, reason: "stopped" };
      },
    });
    expect(sent.every((m) => m.attempt === 2)).toBe(true);
  });

  it("does not start a run that was replaced while it waited", async () => {
    const sent: unknown[] = [];
    let crawled = false;
    await runFullJob("https://a.example/", {
      model: null,
      done: [],
      maxPages: 50,
      fixesLeft: 0,
      attempt: 1,
      shouldStop: () => true,
      send: async (m) => void sent.push(m),
      crawl: async () => {
        crawled = true;
        return { tested: 0, reason: "done" };
      },
    });
    expect(crawled).toBe(false);
    expect(sent).toEqual([]);
  });
});
