// Spending: every test that writes agent_spend lives here, because the test
// database is shared and "today's spend" is a total over all of it.
import { beforeAll, describe, expect, inject, it } from "vitest";

type Data = typeof import("@/lib/data");
let data: Data;
const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  data = await import("@/lib/data");
});

describe("agent spend", () => {
  it("stores the agent mode on the scan, off unless told", async () => {
    const off = await data.createScan({ url: "https://m1.example/", host: "m1.example", ipHash: null });
    const on = await data.createScan({ url: "https://m2.example/", host: "m2.example", ipHash: null, agent: "on" });
    expect(off.agent).toBe("off");
    expect((await data.getScan(on.id))?.agent).toBe("on");
  });

  it("charges a scan run once, however often the worker repeats it", async () => {
    const before = await data.freeSpendTodayUsd();
    const scan = await data.createScan({ url: "https://p1.example/", host: "p1.example", ipHash: null, agent: "on" });
    const row = { scanId: scan.id, kind: "free" as const, model: "claude-sonnet-5-5", usage, costUsd: 0.25 };
    expect(await data.recordScanSpend(row)).toBe(true);
    expect(await data.recordScanSpend(row)).toBe(false);
    expect(await data.freeSpendTodayUsd()).toBeCloseTo(before + 0.25, 6);
  });

  it("counts free and free-chat spend today, not paid spend or yesterday's", async () => {
    const before = await data.freeSpendTodayUsd();
    const scan = await data.createScan({ url: "https://p2.example/", host: "p2.example", ipHash: null });
    await data.recordScanSpend({ scanId: scan.id, kind: "paid", model: "m", usage, costUsd: 5 });
    const { db } = await import("@/lib/db");
    await db()`insert into agent_spend (scan_id, kind, model, input_tokens, output_tokens, cost_usd)
      values (${scan.id}, 'chat_free', 'm', 1, 1, 0.5)`;
    await db()`insert into agent_spend (scan_id, kind, model, input_tokens, output_tokens, cost_usd, created_at)
      values (${scan.id}, 'chat_free', 'm', 1, 1, 7, date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 second')`;
    expect(await data.freeSpendTodayUsd()).toBeCloseTo(before + 0.5, 6);
  });
});

describe("prices and the daily cap", () => {
  const set = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  it("needs both prices as positive numbers", async () => {
    const { agentPrices } = await import("@/lib/spend");
    set({ AGENT_PRICE_INPUT_PER_MTOK: "2", AGENT_PRICE_OUTPUT_PER_MTOK: "10" });
    expect(agentPrices()).toEqual({ inputPerMtok: 2, outputPerMtok: 10 });
    for (const bad of ["", "abc", "-1", "0"]) {
      set({ AGENT_PRICE_INPUT_PER_MTOK: bad });
      expect(agentPrices()).toBeNull();
    }
    set({ AGENT_PRICE_INPUT_PER_MTOK: "2", AGENT_PRICE_OUTPUT_PER_MTOK: undefined });
    expect(agentPrices()).toBeNull();
  });

  it("prices input, output and both kinds of cached input", async () => {
    const { costUsd } = await import("@/lib/spend");
    const p = { inputPerMtok: 2, outputPerMtok: 10 };
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, p)).toBeCloseTo(2, 9);
    expect(costUsd({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, p)).toBeCloseTo(10, 9);
    expect(costUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 }, p)).toBeCloseTo(0.2, 9);
    expect(costUsd({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 }, p)).toBeCloseTo(2.5, 9);
  });

  it("uses a cap of 10 dollars unless a valid one is set", async () => {
    const { dailyCapUsd } = await import("@/lib/spend");
    set({ AGENT_DAILY_CAP_USD: undefined });
    expect(dailyCapUsd()).toBe(10);
    set({ AGENT_DAILY_CAP_USD: "25" });
    expect(dailyCapUsd()).toBe(25);
    set({ AGENT_DAILY_CAP_USD: "0" });
    expect(dailyCapUsd()).toBe(0);
    set({ AGENT_DAILY_CAP_USD: "lots" });
    expect(dailyCapUsd()).toBe(10);
  });

  it("switches the agent off at exactly the cap, and keeps it off without prices", async () => {
    const { freeAgentMode } = await import("@/lib/spend");
    set({ AGENT_PRICE_INPUT_PER_MTOK: undefined, AGENT_PRICE_OUTPUT_PER_MTOK: undefined, AGENT_DAILY_CAP_USD: undefined });
    expect(await freeAgentMode()).toBe("off");

    set({ AGENT_PRICE_INPUT_PER_MTOK: "2", AGENT_PRICE_OUTPUT_PER_MTOK: "10" });
    const spent = await data.freeSpendTodayUsd();
    set({ AGENT_DAILY_CAP_USD: String(spent + 1) });
    expect(await freeAgentMode()).toBe("on");
    const scan = await data.createScan({ url: "https://cap.example/", host: "cap.example", ipHash: null, agent: "on" });
    await data.recordScanSpend({ scanId: scan.id, kind: "free", model: "m", usage, costUsd: 1 });
    expect(await freeAgentMode()).toBe("capped");
    set({ AGENT_DAILY_CAP_USD: String(spent + 1.000001) });
    expect(await freeAgentMode()).toBe("on");
    set({ AGENT_PRICE_INPUT_PER_MTOK: undefined, AGENT_PRICE_OUTPUT_PER_MTOK: undefined, AGENT_DAILY_CAP_USD: undefined });
  });
});
