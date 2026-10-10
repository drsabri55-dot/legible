// Spending: every test that writes agent_spend lives here, because the test
// database is shared and "today's spend" is a total over all of it.
import { beforeAll, describe, expect, inject, it, vi } from "vitest";

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
    const scan = await data.createScan({ url: "https://cap.example/", host: "cap.example", ipHash: null, agent: "on" });
    await data.recordScanSpend({ scanId: scan.id, kind: "free", model: "m", usage, costUsd: 1 });
    // Today's spend plus the scans still running, at the recent average cost.
    const projected =
      (await data.freeSpendTodayUsd()) + (await data.freeAgentScansInFlight()) * ((await data.averageFreeScanCostUsd()) ?? 0);
    set({ AGENT_DAILY_CAP_USD: String(projected + 0.5) });
    expect(await freeAgentMode()).toBe("on");
    set({ AGENT_DAILY_CAP_USD: String(projected) });
    expect(await freeAgentMode()).toBe("capped");
    set({ AGENT_PRICE_INPUT_PER_MTOK: undefined, AGENT_PRICE_OUTPUT_PER_MTOK: undefined, AGENT_DAILY_CAP_USD: undefined });
  });
});

describe("starting a free scan", () => {
  it("sends the agent while under the cap, and records when the cap left it out", async () => {
    process.env.ALLOW_PRIVATE_TARGETS = "1";
    process.env.WORKER_URL = "http://worker.test";
    process.env.WORKER_SECRET = "worker-secret-for-tests-0000";
    const bodies: { agent?: boolean }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 202 });
    });
    try {
      const { startScan } = await import("@/lib/scans");
      process.env.AGENT_PRICE_INPUT_PER_MTOK = "2";
      process.env.AGENT_PRICE_OUTPUT_PER_MTOK = "10";
      process.env.AGENT_DAILY_CAP_USD = String((await data.freeSpendTodayUsd()) + 100);
      const a = await startScan("https://start-a.example", "10.0.0.1");
      process.env.AGENT_DAILY_CAP_USD = "0";
      const b = await startScan("https://start-b.example", "10.0.0.2");
      delete process.env.AGENT_PRICE_INPUT_PER_MTOK;
      const c = await startScan("https://start-c.example", "10.0.0.3");
      expect(bodies.map((x) => x.agent)).toEqual([true, false, false]);
      const modes = await Promise.all([a, b, c].map(async (r) => (r.ok ? (await data.getScan(r.id))?.agent : r.error)));
      expect(modes).toEqual(["on", "capped", "off"]);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.AGENT_PRICE_OUTPUT_PER_MTOK;
      delete process.env.AGENT_DAILY_CAP_USD;
      delete process.env.ALLOW_PRIVATE_TARGETS;
    }
  });
});

describe("the worker's final message", () => {
  const SECRET = "worker-secret-for-tests-0000";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
  const post = async (id: string, body: unknown) => {
    const route = await import("@/app/api/worker/scans/[id]/route");
    return route.POST(
      new Request("http://x/", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
      ctx(id),
    );
  };
  const spendFor = async (id: string) => {
    const { db } = await import("@/lib/db");
    return db()<{ kind: string; input_tokens: number; cost_usd: string | null }[]>`select kind, input_tokens, cost_usd from agent_spend where scan_id = ${id}`;
  };

  it("records the agent's spend once on completion, even when repeated", async () => {
    process.env.WORKER_SECRET = SECRET;
    process.env.AGENT_PRICE_INPUT_PER_MTOK = "2";
    process.env.AGENT_PRICE_OUTPUT_PER_MTOK = "10";
    const { sampleScan } = await import("./fixture");
    const scan = await data.createScan({ url: "https://w1.example/", host: "w1.example", ipHash: null, agent: "on" });
    const raw = { ...sampleScan(), agent: { model: "claude-sonnet-5-5", usage: { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 } } };
    expect((await post(scan.id, { type: "complete", raw })).status).toBe(200);
    expect((await post(scan.id, { type: "complete", raw })).status).toBe(200);
    const rows = await spendFor(scan.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "free", input_tokens: 1_000_000 });
    expect(Number(rows[0].cost_usd)).toBeCloseTo(3, 6);
  });

  it("records the spend of a scan that failed, and of one already closed as stale", async () => {
    const failed = await data.createScan({ url: "https://w2.example/", host: "w2.example", ipHash: null, agent: "on" });
    const agent = { model: "claude-sonnet-5-5", usage: { inputTokens: 500_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    await post(failed.id, { type: "failed", error: "robots", agent });
    expect(Number((await spendFor(failed.id))[0].cost_usd)).toBeCloseTo(1, 6);

    const stale = await data.createScan({ url: "https://w3.example/", host: "w3.example", ipHash: null, agent: "on" });
    await data.failScan(stale.id, "timeout");
    const { sampleScan } = await import("./fixture");
    await post(stale.id, { type: "complete", raw: { ...sampleScan(), agent } });
    expect(await spendFor(stale.id)).toHaveLength(1);
  });

  it("keeps the tokens with no cost when the prices were removed mid-scan", async () => {
    delete process.env.AGENT_PRICE_INPUT_PER_MTOK;
    const scan = await data.createScan({ url: "https://w4.example/", host: "w4.example", ipHash: null, agent: "on" });
    const { sampleScan } = await import("./fixture");
    await post(scan.id, { type: "complete", raw: { ...sampleScan(), agent: { model: "m", usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } } });
    expect((await spendFor(scan.id))[0]).toMatchObject({ input_tokens: 5, cost_usd: null });
    delete process.env.AGENT_PRICE_OUTPUT_PER_MTOK;
  });
});

describe("scans still running count against the cap", () => {
  it("projects running agent scans at the recent average cost", async () => {
    const { decideFreeAgent } = await import("@/lib/spend");
    // Under the cap with nothing running.
    expect(decideFreeAgent({ spent: 5, cap: 10, inFlight: 0, averageScanCost: 1 })).toBe("on");
    // 5 spent + 4 running at $1 = 9: one more may start.
    expect(decideFreeAgent({ spent: 5, cap: 10, inFlight: 4, averageScanCost: 1 })).toBe("on");
    // 5 + 5 running = 10: at the cap, so no more.
    expect(decideFreeAgent({ spent: 5, cap: 10, inFlight: 5, averageScanCost: 1 })).toBe("capped");
    expect(decideFreeAgent({ spent: 10, cap: 10, inFlight: 0, averageScanCost: 1 })).toBe("capped");
  });

  it("allows only two agent scans at once before any cost is known", async () => {
    const { decideFreeAgent } = await import("@/lib/spend");
    expect(decideFreeAgent({ spent: 0, cap: 10, inFlight: 1, averageScanCost: null })).toBe("on");
    expect(decideFreeAgent({ spent: 0, cap: 10, inFlight: 2, averageScanCost: null })).toBe("capped");
  });

  it("counts agent scans that have not been charged yet, and the recent average cost", async () => {
    const before = await data.freeAgentScansInFlight();
    const running = await data.createScan({ url: "https://f1.example/", host: "f1.example", ipHash: null, agent: "on" });
    await data.createScan({ url: "https://f2.example/", host: "f2.example", ipHash: null, agent: "capped" });
    expect(await data.freeAgentScansInFlight()).toBe(before + 1);
    // Once charged (even while its result is still arriving) it no longer counts.
    await data.recordScanSpend({ scanId: running.id, kind: "free", model: "m", usage, costUsd: 0 });
    expect(await data.freeAgentScansInFlight()).toBe(before);
    const avg = await data.averageFreeScanCostUsd();
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThanOrEqual(0);
  });
});
