// Asking a question: limits, the daily cap, failures and the safety net.
import { beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { buildReport, freeSummary } from "@/lib/report/model";
import { sampleScan } from "./fixture";

type Data = typeof import("@/lib/data");
let data: Data;
let ask: typeof import("@/lib/chat/ask");
let FakeChatModel: typeof import("@/lib/chat/model").FakeChatModel;

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
  process.env.AGENT_PRICE_INPUT_PER_MTOK = "2";
  process.env.AGENT_PRICE_OUTPUT_PER_MTOK = "10";
  data = await import("@/lib/data");
  ask = await import("@/lib/chat/ask");
  ({ FakeChatModel } = await import("@/lib/chat/model"));
});
beforeEach(() => {
  delete process.env.AGENT_DAILY_CAP_USD;
  process.env.ANTHROPIC_API_KEY = "test-key-never-sent";
});

async function finished(host: string) {
  const s = await data.createScan({ url: `https://${host}/`, host, ipHash: null });
  const raw = sampleScan();
  const report = buildReport(raw);
  await data.completeScan(s.id, { raw, score: report.score, summary: freeSummary(report), pagesDone: 2 });
  return s;
}
const fake = () => new FakeChatModel();

describe("askQuestion", () => {
  it("answers, saves both messages and charges free chat", async () => {
    const s = await finished("ask-ok.test");
    const r = await ask.askQuestion(s.id, "What should I fix first?", fake());
    expect(r).toEqual({ ok: true, answer: "Test answer to: What should I fix first?" });
    expect((await data.listChat(s.id)).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await data.freeSpendTodayUsd()).toBeGreaterThan(0);
  });

  it("stops at 5 free questions", async () => {
    const s = await finished("ask-five.test");
    for (let i = 0; i < 5; i++) expect((await ask.askQuestion(s.id, `q${i}`, fake())).ok).toBe(true);
    expect(await ask.askQuestion(s.id, "q6", fake())).toEqual({ ok: false, code: "used" });
  });

  it("parallel questions never pass the limit", async () => {
    const s = await finished("ask-parallel.test");
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => ask.askQuestion(s.id, `q${i}`, fake())));
    expect(rs.filter((r) => r.ok)).toHaveLength(5);
  });

  it("a failed answer does not use a question", async () => {
    const s = await finished("ask-fail.test");
    expect(await ask.askQuestion(s.id, "[fail]", fake())).toEqual({ ok: false, code: "failed" });
    expect(await data.countQuestions(s.id)).toBe(0);
  });

  it("a banned phrase from the model is replaced", async () => {
    const s = await finished("ask-law.test");
    const r = await ask.askQuestion(s.id, "[law] Is my site legal?", fake());
    expect(r).toEqual({ ok: true, answer: expect.stringContaining("I can't tell you whether your site meets the law.") });
    expect((await data.listChat(s.id)).at(-1)!.body).not.toContain("compliant");
  });

  it("refuses empty and long questions without using one", async () => {
    const s = await finished("ask-len.test");
    expect(await ask.askQuestion(s.id, "   ", fake())).toEqual({ ok: false, code: "empty" });
    expect(await ask.askQuestion(s.id, "x".repeat(501), fake())).toEqual({ ok: false, code: "too_long" });
    expect(await data.countQuestions(s.id)).toBe(0);
  });

  it("pauses free chat at the daily cap, but not paid chat", async () => {
    const s = await finished("ask-cap.test");
    process.env.AGENT_DAILY_CAP_USD = "0";
    expect(await ask.askQuestion(s.id, "q", fake())).toEqual({ ok: false, code: "paused" });
    const user = await data.upsertUser("buyer@ask-cap.test");
    await data.createReportOnce({ scanId: s.id, userId: user.id, token: "tok-askcap-0123456789abcdef", stripeSessionId: null, amountCents: 9900, currency: "usd" });
    expect((await ask.askQuestion(s.id, "q", fake())).ok).toBe(true);
  });

  it("is off without the key", async () => {
    const s = await finished("ask-off.test");
    delete process.env.ANTHROPIC_API_KEY;
    expect(await ask.askQuestion(s.id, "q", fake())).toEqual({ ok: false, code: "off" });
  });

  it("chatState counts what is left", async () => {
    const s = await finished("ask-state.test");
    await ask.askQuestion(s.id, "q", fake());
    const st = await ask.chatState((await data.getScan(s.id))!);
    expect(st).toMatchObject({ mode: "open", paid: false, limit: 5, left: 4 });
    expect(st.messages).toHaveLength(2);
  });
});

describe("what the model is sent", () => {
  it("starts with a question and ends with this question and the scan's data", async () => {
    const s = await finished("ask-history.test");
    await data.saveAnswer(s.id, "An answer with no question before it.");
    const seen: { role: string; content: string }[][] = [];
    const model = { name: "spy", ask: async (req: { messages: { role: "user" | "assistant"; content: string }[] }) => {
      seen.push(req.messages);
      return { text: "Fine.", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    } };
    await ask.askQuestion(s.id, "First?", model as never);
    expect(seen[0][0].role).toBe("user");
    expect(seen[0].at(-1)!.content).toMatch(/^<site_data>[\s\S]*<\/site_data>\n\nQuestion: First\?$/);
  });
});

describe("the chat route", () => {
  const post = async (id: string, body: unknown, origin = "http://site.test") => {
    const { POST } = await import("@/app/api/scans/[id]/chat/route");
    const headers: Record<string, string> = { host: "site.test", "content-type": "application/json" };
    if (origin) headers.origin = origin;
    return POST(new Request(`http://site.test/api/scans/${id}/chat`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) } as never);
  };

  it("answers with what is left, and maps refusals to status codes", async () => {
    process.env.CHAT_FAKE_MODEL = "1";
    process.env.ALLOW_PRIVATE_TARGETS = "1";
    try {
      const s = await finished("route-chat.test");
      const ok = await post(s.id, { question: "Hello" });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ answer: "Test answer to: Hello", left: 4 });
      expect((await post(s.id, { question: "[fail]" })).status).toBe(502);
      expect((await post(s.id, { question: "x".repeat(501) })).status).toBe(400);
      expect((await post(s.id, { nope: 1 })).status).toBe(400);
      expect((await post("00000000-0000-4000-8000-000000000000", { question: "Hi" })).status).toBe(404);
      expect((await post(s.id, { question: "Hi" }, "https://evil.test")).status).toBe(403);
      expect((await post(s.id, { question: "Hi" }, "")).status).toBe(403);
    } finally {
      delete process.env.CHAT_FAKE_MODEL;
      delete process.env.ALLOW_PRIVATE_TARGETS;
    }
  });

  it("GET shows the conversation and the mode", async () => {
    const { GET } = await import("@/app/api/scans/[id]/chat/route");
    const s = await finished("route-get.test");
    await ask.askQuestion(s.id, "Hi", fake());
    const res = await GET(new Request("http://site.test/"), { params: Promise.resolve({ id: s.id }) } as never);
    expect(await res.json()).toMatchObject({ mode: "open", left: 4, limit: 5, paid: false, messages: [{ role: "user", body: "Hi" }, { role: "assistant" }] });
  });
});
