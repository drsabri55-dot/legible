// The site's side of the whole-site test: starting it, storing each page the
// worker sends, the report's spending limit, resuming and the last email.
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { buildReport, freeSummary } from "@/lib/report/model";
import { page, rule, sampleScan } from "./fixture";

const sent: { template: string; to: string; vars: Record<string, unknown>; attachments?: { filename: string }[] }[] = [];
const alerts: string[] = [];
const failing = { full: 0 };
vi.mock("@/lib/email/send", () => ({
  sendEmail: async (e: (typeof sent)[number]) => {
    if (e.template === "full-report-ready" && failing.full > 0) {
      failing.full--;
      throw new Error("Resend is down");
    }
    sent.push(e);
    return null;
  },
  alertOwner: async (subject: string) => void alerts.push(subject),
}));

type Data = typeof import("@/lib/data");
let data: Data;
const SECRET = "worker-secret-for-tests-0000";
const jobs: Record<string, unknown>[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  process.env.WORKER_SECRET = SECRET;
  process.env.WORKER_URL = "http://worker.test";
  process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
  process.env.AGENT_PRICE_INPUT_PER_MTOK = "2";
  process.env.AGENT_PRICE_OUTPUT_PER_MTOK = "10";
  data = await import("@/lib/data");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/jobs/full")) {
      jobs.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 202 });
    }
    if (url.endsWith("/pdf")) return new Response(Buffer.from("%PDF-1.7 test"), { status: 200 });
    return new Response("not found", { status: 404 });
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  sent.length = 0;
  alerts.length = 0;
  jobs.length = 0;
  delete process.env.AGENT_REPORT_CAP_USD;
});

async function paidReport(host: string) {
  const scan = await data.createScan({ url: `https://${host}/`, host, ipHash: null });
  const raw = sampleScan();
  const report = buildReport(raw);
  await data.completeScan(scan.id, { raw, score: report.score, summary: freeSummary(report), pagesDone: 2 });
  const user = await data.upsertUser(`buyer@${host}`);
  const { report: row } = await data.createReportOnce({ scanId: scan.id, userId: user.id, token: `tok-${host.replace(/\W/g, "")}-0123456789abcdef`, stripeSessionId: null, amountCents: 9900, currency: "usd" });
  return { scan, report: row };
}

// Messages carry the run they belong to; by default the current one.
const post = async (id: string, message: Record<string, unknown>) => {
  const body = "attempt" in message ? message : { ...message, attempt: (await data.getReportByScanId(id))?.full_attempts };
  const route = await import("@/app/api/worker/full/[id]/route");
  const res = await route.POST(
    new Request("http://x/", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) } as never,
  );
  const out = { status: res.status, body: await res.json() };
  // Work the route runs after answering (the email, a retry) finishes here.
  await new Promise((r) => setTimeout(r, 30));
  return out;
};
const agent = { model: "claude-sonnet-5-5", usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
const reportOf = async (scanId: string) => (await data.getReportByScanId(scanId))!;

describe("starting", () => {
  it("sends the worker the pages already tested, the page limit and the AI fixes left", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr1.example");
    const stored = page("https://www.shop.example/team", [rule("image-alt", "critical", ["<img>"])], []);
    stored.violations[0].nodes[0].fix = { code: "x", kind: "css", status: "tested", source: "ai" };
    await data.saveFullPage(scan.id, stored.url, stored);
    expect(await startFullTest(report)).toBe(true);
    expect(jobs[0]).toMatchObject({
      scanId: scan.id,
      url: "https://www.shop.example/",
      done: ["https://www.shop.example/", "https://www.shop.example/about", "https://www.shop.example/team"],
      maxPages: 50,
      fixesLeft: 299,
      agent: true,
      attempt: 1,
      callbackUrl: `http://localhost:3999/api/worker/full/${scan.id}`,
    });
    expect(await reportOf(scan.id)).toMatchObject({ full_status: "running", full_attempts: 1 });
  });
});

describe("each page", () => {
  it("is stored, counted and charged once, however often the worker repeats it", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr2.example");
    await startFullTest(report);
    const p = page("https://www.shop.example/team", [], ["image-alt"]);
    expect((await post(scan.id, { type: "page", page: p, agent })).body).toEqual({ ok: true, stop: false });
    expect((await post(scan.id, { type: "page", page: p, agent })).body).toEqual({ ok: true, stop: false });
    expect(await data.listFullPages(scan.id)).toHaveLength(1);
    expect((await reportOf(scan.id)).full_pages).toBe(1);
    expect(await data.paidSpendUsd(scan.id)).toBeCloseTo(2, 6);
  });

  it("tells the worker to stop once the report reaches its limit, keeping that page", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr3.example");
    await startFullTest(report);
    process.env.AGENT_REPORT_CAP_USD = "3";
    expect((await post(scan.id, { type: "page", page: page("https://www.shop.example/a", [], []), agent })).body.stop).toBe(false);
    expect((await post(scan.id, { type: "page", page: page("https://www.shop.example/b", [], []), agent })).body.stop).toBe(true);
    expect(await data.listFullPages(scan.id)).toHaveLength(2);
  });

  it("refuses messages without the worker's secret, and pages that are not pages", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr4.example");
    await startFullTest(report);
    const route = await import("@/app/api/worker/full/[id]/route");
    const res = await route.POST(new Request("http://x/", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: scan.id }) } as never);
    expect(res.status).toBe(401);
    expect((await post(scan.id, { type: "page", page: { url: 5 } })).status).toBe(400);
  });
});

describe("the end of the run", () => {
  it("finishes once and sends one email with the PDF", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr5.example");
    await startFullTest(report);
    await post(scan.id, { type: "page", page: page("https://www.shop.example/a", [], []) });
    await post(scan.id, { type: "done", reason: "done", tested: 1 });
    await post(scan.id, { type: "done", reason: "done", tested: 1 });
    expect((await reportOf(scan.id)).full_status).toBe("done");
    const emails = sent.filter((e) => e.template === "full-report-ready");
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: "buyer@fr5.example", vars: { pages: "3 pages" } });
    expect(emails[0].attachments?.[0].filename).toMatch(/\.pdf$/);
  });

  it("says the limit stopped it when the spend reached the limit", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr6.example");
    await startFullTest(report);
    process.env.AGENT_REPORT_CAP_USD = "1";
    await post(scan.id, { type: "page", page: page("https://www.shop.example/a", [], []), agent });
    await post(scan.id, { type: "done", reason: "stopped", tested: 1 });
    expect((await reportOf(scan.id)).full_status).toBe("limit");
  });

  it("tries again after an error on the worker, then gives up after three tries", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr7.example");
    await startFullTest(report);
    await post(scan.id, { type: "done", reason: "error", tested: 0 });
    expect(await reportOf(scan.id)).toMatchObject({ full_status: "running", full_attempts: 2 });
    await post(scan.id, { type: "done", reason: "error", tested: 0 });
    await post(scan.id, { type: "done", reason: "error", tested: 0 });
    expect((await reportOf(scan.id)).full_status).toBe("stopped");
    expect(sent.filter((e) => e.template === "full-report-ready")).toHaveLength(1);
  });
});

describe("a run that went quiet", () => {
  it("resumes from the stored pages, and finishes after three tries", async () => {
    const { startFullTest, resumeStaleFullTest } = await import("@/lib/full");
    const { db } = await import("@/lib/db");
    const { scan, report } = await paidReport("fr8.example");
    await startFullTest(report);
    await post(scan.id, { type: "page", page: page("https://www.shop.example/a", [], []) });
    await resumeStaleFullTest(await reportOf(scan.id));
    expect(jobs).toHaveLength(1); // not quiet yet
    const quiet = async () => db()`update reports set full_updated_at = now() - interval '21 minutes' where id = ${report.id}`;
    await quiet();
    await resumeStaleFullTest(await reportOf(scan.id));
    expect(jobs).toHaveLength(2);
    expect(jobs[1].done).toContain("https://www.shop.example/a");
    await quiet();
    await resumeStaleFullTest(await reportOf(scan.id));
    await quiet();
    await resumeStaleFullTest(await reportOf(scan.id));
    expect(jobs).toHaveLength(3);
    expect((await reportOf(scan.id)).full_status).toBe("stopped");
  });

  it("never touches reports bought before the whole-site test", async () => {
    const { resumeStaleFullTest } = await import("@/lib/full");
    const { scan } = await paidReport("fr9.example");
    await resumeStaleFullTest(await reportOf(scan.id));
    expect(jobs).toHaveLength(0);
    expect((await reportOf(scan.id)).full_status).toBeNull();
  });
});

describe("the email at purchase", () => {
  it("starts the whole-site test and says so, with the PDF kept for the last email", async () => {
    const { deliverReport } = await import("@/lib/fulfil");
    const { scan, report } = await paidReport("fr10.example");
    await deliverReport(report, "buyer@fr10.example");
    expect(jobs).toHaveLength(1);
    expect((await reportOf(scan.id)).full_status).toBe("running");
    const email = sent.find((e) => e.template === "report-ready")!;
    expect(email.attachments ?? []).toHaveLength(0);
    expect(String(email.vars.pdf_note)).toContain("testing the rest of your site");
  });
});

describe("the report", () => {
  it("is built from the free scan and every stored page", async () => {
    const { fullReport } = await import("@/lib/full");
    const { scan } = await paidReport("fr11.example");
    await data.saveFullPage(scan.id, "https://www.shop.example/team", page("https://www.shop.example/team", [], ["image-alt"]));
    const raw = (await data.getScanRaw(scan.id))!;
    expect((await fullReport(raw, scan.id)).pagesScanned).toBe(3);
  });
});

describe("runs that overlap or go wrong", () => {
  const quiet = async (reportId: string) => {
    const { db } = await import("@/lib/db");
    await db()`update reports set full_updated_at = now() - interval '21 minutes' where id = ${reportId}`;
  };

  it("resumes a quiet run once, even when two views ask at the same moment", async () => {
    const { startFullTest, resumeStaleFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr12.example");
    await startFullTest(report);
    await quiet(report.id);
    const row = await reportOf(scan.id);
    await Promise.all([resumeStaleFullTest(row), resumeStaleFullTest(row)]);
    expect(jobs).toHaveLength(2);
    expect((await reportOf(scan.id)).full_attempts).toBe(2);
    expect(jobs[1].attempt).toBe(2);
  });

  it("ignores an older run's messages once a newer run has started", async () => {
    const { startFullTest, resumeStaleFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr13.example");
    await startFullTest(report);
    await quiet(report.id);
    await resumeStaleFullTest(await reportOf(scan.id));
    const old = await post(scan.id, { type: "page", page: page("https://www.shop.example/old", [], []), agent, attempt: 1 });
    expect(old.body.stop).toBe(true);
    expect(await data.listFullPages(scan.id)).toHaveLength(0);
    expect(await data.paidSpendUsd(scan.id)).toBeCloseTo(2, 6); // what it used is still charged
    await post(scan.id, { type: "done", reason: "done", tested: 1, attempt: 1 });
    expect((await reportOf(scan.id)).full_status).toBe("running");
  });

  it("keeps a run that is waiting or working from looking quiet", async () => {
    const { scan, report } = await paidReport("fr14.example");
    const { startFullTest } = await import("@/lib/full");
    await startFullTest(report);
    await quiet(report.id);
    expect((await post(scan.id, { type: "alive" })).body).toEqual({ ok: true, stop: false });
    expect((await data.staleFullJobs(20)).map((r) => r.id)).not.toContain(report.id);
    expect((await post(scan.id, { type: "alive", attempt: 99 })).body.stop).toBe(true);
  });

  it("stops at 50 pages in all, counting the free scan's", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr15.example");
    await startFullTest(report);
    for (let i = 0; i < 47; i++) await data.saveFullPage(scan.id, `https://www.shop.example/p${i}`, page(`https://www.shop.example/p${i}`, [], []));
    expect((await post(scan.id, { type: "page", page: page("https://www.shop.example/last", [], []) })).body.stop).toBe(true);
  });

  it("finishes at the limit instead of resuming a run that already spent it", async () => {
    const { startFullTest, resumeStaleFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr16.example");
    await startFullTest(report);
    await post(scan.id, { type: "page", page: page("https://www.shop.example/a", [], []), agent });
    process.env.AGENT_REPORT_CAP_USD = "1";
    await quiet(report.id);
    await resumeStaleFullTest(await reportOf(scan.id));
    expect(jobs).toHaveLength(1);
    expect((await reportOf(scan.id)).full_status).toBe("limit");
  });

  it("stops a run whose spend can no longer be priced", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr17.example");
    await startFullTest(report);
    delete process.env.AGENT_PRICE_INPUT_PER_MTOK;
    try {
      expect((await post(scan.id, { type: "page", page: page("https://www.shop.example/a", [], []), agent })).body.stop).toBe(true);
    } finally {
      process.env.AGENT_PRICE_INPUT_PER_MTOK = "2";
    }
  });

  it("tries the last email again, and tells the owner, when sending fails", async () => {
    const { startFullTest, retryUnsentFullEmails } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr18.example");
    await startFullTest(report);
    failing.full = 1;
    await post(scan.id, { type: "done", reason: "done", tested: 0 });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.filter((e) => e.template === "full-report-ready")).toHaveLength(0);
    expect(alerts.some((a) => /email/i.test(a))).toBe(true);
    await retryUnsentFullEmails(0);
    expect(sent.filter((e) => e.template === "full-report-ready")).toHaveLength(1);
  });

  it("says when the PDF could not be attached", async () => {
    const { startFullTest } = await import("@/lib/full");
    const { scan, report } = await paidReport("fr19.example");
    await startFullTest(report);
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/pdf") ? new Response("down", { status: 503 }) : new Response("{}", { status: 202 }),
    );
    try {
      await post(scan.id, { type: "done", reason: "done", tested: 0 });
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        if (url.endsWith("/jobs/full")) {
          jobs.push(JSON.parse(String(init.body)));
          return new Response("{}", { status: 202 });
        }
        if (url.endsWith("/pdf")) return new Response(Buffer.from("%PDF-1.7 test"), { status: 200 });
        return new Response("not found", { status: 404 });
      });
    }
    const email = sent.find((e) => e.template === "full-report-ready")!;
    expect(email.attachments ?? []).toHaveLength(0);
    expect(String(email.vars.pdf_note)).toContain("Download it from the report page");
  });
});

describe("the purchase email when the test cannot be set up", () => {
  it("still goes out, with the PDF", async () => {
    const { deliverReport } = await import("@/lib/fulfil");
    const { report } = await paidReport("fr20.example");
    // A database error while starting the test (an id the database refuses).
    // (Marking the fake id delivered fails afterwards; the email is what matters.)
    await deliverReport({ ...report, id: "not-a-uuid" }, "buyer@fr20.example").catch(() => {});
    const email = sent.find((e) => e.template === "report-ready")!;
    expect(email).toBeTruthy();
    expect(email.attachments?.[0].filename).toMatch(/\.pdf$/);
    expect(alerts.length).toBeGreaterThan(0);
  });
});
