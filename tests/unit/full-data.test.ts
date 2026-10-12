// The whole-site test's tables. Every test that writes paid spend lives here.
import { beforeAll, describe, expect, inject, it } from "vitest";
import { buildReport, freeSummary } from "@/lib/report/model";
import { page, rule, sampleScan } from "./fixture";

type Data = typeof import("@/lib/data");
let data: Data;
const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  data = await import("@/lib/data");
});

async function paidReport(host: string) {
  const scan = await data.createScan({ url: `https://${host}/`, host, ipHash: null });
  const raw = sampleScan();
  const report = buildReport(raw);
  await data.completeScan(scan.id, { raw, score: report.score, summary: freeSummary(report), pagesDone: 2 });
  const user = await data.upsertUser(`buyer@${host}`);
  const { report: row } = await data.createReportOnce({ scanId: scan.id, userId: user.id, token: `tok-${host}-0123456789abcdef`, stripeSessionId: null, amountCents: 9900, currency: "usd" });
  return { scan, report: row };
}

describe("whole-site pages", () => {
  it("stores each page once, in the order it arrived", async () => {
    const { scan } = await paidReport("fp1.example");
    const a = page("https://fp1.example/a", [rule("image-alt", "critical", ["<img>"])], []);
    const b = page("https://fp1.example/b", [], ["image-alt"]);
    expect(await data.saveFullPage(scan.id, a.url, a)).toBe(true);
    expect(await data.saveFullPage(scan.id, a.url, a)).toBe(false);
    expect(await data.saveFullPage(scan.id, b.url, b)).toBe(true);
    expect((await data.listFullPages(scan.id)).map((p) => p.url)).toEqual([a.url, b.url]);
  });
});

describe("the whole-site run", () => {
  it("starts, records progress, finishes once and emails once", async () => {
    const { report } = await paidReport("fp2.example");
    expect(report.full_status).toBeNull();
    await data.startFullJob(report.id);
    await data.touchFullJob(report.id, 7);
    let row = await data.getReportByScanId(report.scan_id);
    expect(row).toMatchObject({ full_status: "running", full_pages: 7, full_attempts: 1 });
    expect(await data.finishFullJob(report.id, "limit")).toBe(true);
    expect(await data.finishFullJob(report.id, "done")).toBe(false);
    row = await data.getReportByScanId(report.scan_id);
    expect(row?.full_status).toBe("limit");
    expect(await data.claimFullEmail(report.id)).toBe(true);
    expect(await data.claimFullEmail(report.id)).toBe(false);
  });

  it("finds runs that have gone quiet", async () => {
    const { report } = await paidReport("fp3.example");
    await data.startFullJob(report.id);
    expect((await data.staleFullJobs(20)).map((r) => r.id)).not.toContain(report.id);
    const { db } = await import("@/lib/db");
    await db()`update reports set full_updated_at = now() - interval '21 minutes' where id = ${report.id}`;
    expect((await data.staleFullJobs(20)).map((r) => r.id)).toContain(report.id);
  });
});

describe("paid spend", () => {
  it("charges each page once and adds up the report's spend", async () => {
    const { scan } = await paidReport("fp4.example");
    const row = (ref: string) => ({ scanId: scan.id, kind: "paid" as const, model: "m", usage, costUsd: 0.5, ref });
    expect(await data.recordScanSpend(row("https://fp4.example/a"))).toBe(true);
    expect(await data.recordScanSpend(row("https://fp4.example/a"))).toBe(false);
    expect(await data.recordScanSpend(row("https://fp4.example/b"))).toBe(true);
    expect(await data.paidSpendUsd(scan.id)).toBeCloseTo(1, 6);
    // The free run of the same scan is still charged once, apart from paid pages.
    expect(await data.recordScanSpend({ scanId: scan.id, kind: "free", model: "m", usage, costUsd: 0.2 })).toBe(true);
    expect(await data.recordScanSpend({ scanId: scan.id, kind: "free", model: "m", usage, costUsd: 0.2 })).toBe(false);
    expect(await data.paidSpendUsd(scan.id)).toBeCloseTo(1, 6);
  });
});
