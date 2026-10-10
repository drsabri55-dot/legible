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
