// The job the worker runs for each scan: what it sends back to the site,
// above all the agent's spend, which the site charges against its daily cap.
import { describe, expect, it } from "vitest";
import { runScanJob } from "../src/job";
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
