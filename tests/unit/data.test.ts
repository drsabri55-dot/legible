// Runs every query in src/lib/data.ts against a real Postgres built from the
// migrations (see tests/setup/postgres.ts).
import { beforeAll, describe, expect, inject, it } from "vitest";
import { buildReport, freeSummary } from "@/lib/report/model";
import { sampleScan } from "./fixture";

type Data = typeof import("@/lib/data");
let data: Data;

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  data = await import("@/lib/data");
});

async function completedScan(host = "shop.example") {
  const scan = await data.createScan({ url: `https://${host}/`, host, ipHash: `ip-${host}` });
  const raw = sampleScan();
  const report = buildReport(raw);
  expect(await data.completeScan(scan.id, { raw, score: report.score, summary: freeSummary(report), pagesDone: 2 })).toBe(true);
  return scan;
}

describe("scans", () => {
  it("moves through queued, running and complete, and stores the summary", async () => {
    const scan = await data.createScan({ url: "https://a.example/", host: "a.example", ipHash: "ip1" });
    expect(scan.status).toBe("queued");
    await data.markScanProgress(scan.id, 2, 6);
    expect(await data.getScan(scan.id)).toMatchObject({ status: "running", pages_done: 2, pages_total: 6 });
    const raw = sampleScan();
    const report = buildReport(raw);
    await data.completeScan(scan.id, { raw, score: report.score, summary: freeSummary(report), pagesDone: 2 });
    const done = await data.getScan(scan.id);
    expect(done).toMatchObject({ status: "complete", score: report.score });
    expect(done?.summary?.samples).toHaveLength(2);
    expect((await data.getScanRaw(scan.id))?.pages).toHaveLength(3);
    // A late failure message cannot overwrite a finished scan.
    expect(await data.failScan(scan.id, "timeout")).toBe(false);
  });

  it("returns null for ids that are not UUIDs", async () => {
    expect(await data.getScan("not-a-uuid")).toBeNull();
  });

  it("counts recent scans for rate limits", async () => {
    await data.createScan({ url: "https://b.example/", host: "b.example", ipHash: "ip-rate" });
    await data.createScan({ url: "https://b.example/", host: "b.example", ipHash: "ip-rate" });
    expect(await data.countScansByIp("ip-rate", 10)).toBe(2);
    expect(await data.countScansByHost("b.example", 60)).toBe(2);
  });

  it("honours the block list with or without www", async () => {
    const { db } = await import("@/lib/db");
    await db()`insert into blocked_domains (host) values ('blocked.example')`;
    expect(await data.isBlockedHost("www.blocked.example")).toBe(true);
    expect(await data.isBlockedHost("blocked.example")).toBe(true);
    expect(await data.isBlockedHost("fine.example")).toBe(false);
  });
});

describe("reports", () => {
  it("creates exactly one report per scan, however often payment is confirmed", async () => {
    const scan = await completedScan("once.example");
    const user = await data.upsertUser("Buyer@Example.com");
    expect(user.email).toBe("buyer@example.com");
    const input = { scanId: scan.id, userId: user.id, stripeSessionId: "cs_1", amountCents: 9900, currency: "usd" };
    const first = await data.createReportOnce({ ...input, token: "tokenAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    const second = await data.createReportOnce({ ...input, token: "tokenBBBBBBBBBBBBBBBBBBBBBBBBBBB" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.report.token).toBe(first.report.token);
    expect((await data.getScan(scan.id))?.paid_at).toBeTruthy();

    const byToken = await data.getReportByToken(first.report.token);
    expect(byToken).toMatchObject({ email: "buyer@example.com", host: "once.example" });
    expect(await data.listReportsForEmail("BUYER@example.com")).toHaveLength(1);
    expect(await data.getReportByToken("short")).toBeNull();
  });

  it("offers monitoring once, three days after delivery, and only to people who accept offers", async () => {
    const { db } = await import("@/lib/db");
    const scan = await completedScan("offer.example");
    const user = await data.upsertUser("offer@example.com");
    const { report } = await data.createReportOnce({
      scanId: scan.id,
      userId: user.id,
      token: "tokenOFFEROFFEROFFEROFFEROFFER12",
      stripeSessionId: null,
      amountCents: 9900,
      currency: "usd",
    });
    await data.markReportDelivered(report.id);
    expect((await data.reportsDueForOffer()).map((r) => r.id)).not.toContain(report.id);
    await db()`update reports set delivered_at = now() - interval '4 days' where id = ${report.id}`;
    expect((await data.reportsDueForOffer()).map((r) => r.id)).toContain(report.id);
    expect(await data.claimOffer(report.id)).toBe(true);
    expect(await data.claimOffer(report.id)).toBe(false);
    expect((await data.reportsDueForOffer()).map((r) => r.id)).not.toContain(report.id);

    await data.releaseOffer(report.id);
    await data.setMarketingEmails("offer@example.com", false);
    expect((await data.reportsDueForOffer()).map((r) => r.id)).not.toContain(report.id);
  });

  it("records a monitoring request once", async () => {
    const user = await data.upsertUser("monitor@example.com");
    expect(await data.requestMonitoring(user.id, "m.example")).toBe(true);
    expect(await data.requestMonitoring(user.id, "m.example")).toBe(false);
  });
});

describe("idempotency and sign-in", () => {
  it("acts on each Stripe event once", async () => {
    expect(await data.recordStripeEvent("evt_1", "checkout.session.completed")).toBe(true);
    expect(await data.recordStripeEvent("evt_1", "checkout.session.completed")).toBe(false);
    await data.forgetStripeEvent("evt_1");
    expect(await data.recordStripeEvent("evt_1", "checkout.session.completed")).toBe(true);
  });

  it("lets a sign-in link be used once and only before it expires", async () => {
    await data.saveLoginToken("Login@Example.com", "hash-1", 20);
    expect(await data.consumeLoginToken("hash-1")).toBe("login@example.com");
    expect(await data.consumeLoginToken("hash-1")).toBeNull();
    await data.saveLoginToken("login@example.com", "hash-2", -1);
    expect(await data.consumeLoginToken("hash-2")).toBeNull();
    expect(await data.countRecentLoginTokens("login@example.com", 60)).toBe(2);
  });

  it("reports funnel numbers", async () => {
    const rows = await data.stats();
    expect(rows.map((r) => r.period)).toEqual(["Last 7 days", "Last 30 days", "All time"]);
    expect(rows[2].scans).toBeGreaterThan(0);
    expect(rows[2].paid).toBeGreaterThan(0);
  });
});

describe("screenshots", () => {
  it("stores shots against a scan, ignores repeats, and reads them back", async () => {
    const scan = await data.createScan({ url: "https://shots.example/", host: "shots.example", ipHash: "ip-shots" });
    const id = "33333333-3333-4333-8333-333333333333";
    await data.saveShots(scan.id, [{ id, jpeg: Buffer.from([0xff, 0xd8, 0xff, 0x01]) }]);
    await data.saveShots(scan.id, [{ id, jpeg: Buffer.from([0xff, 0xd8, 0xff, 0x02]) }]);
    expect((await data.getShot(id))?.equals(Buffer.from([0xff, 0xd8, 0xff, 0x01]))).toBe(true);
    expect(await data.getShot("44444444-4444-4444-8444-444444444444")).toBeNull();
  });
});
