import "server-only";

// A question about one scan: within its limit, charged, checked, and given
// back when the answer fails.
import {
  countQuestions,
  freeSpendTodayUsd,
  getReportByScanId,
  getScan,
  getScanRaw,
  listChat,
  listLiveEvents,
  releaseQuestion,
  reserveQuestion,
  saveAnswer,
  type ChatRow,
  type ScanRow,
} from "../data";
import { fullReport } from "../full";
import { buildReport } from "../report/model";
import { siteName } from "../url";
import { chargeAgent, dailyCapUsd } from "../spend";
import { chatContext } from "./context";
import { QUESTION_MAX, chatEnabled, chatLimit } from "./limits";
import { chatModelFromEnv, type ChatModel } from "./model";
import { CHAT_SYSTEM } from "./prompt";
import { safeAnswer } from "./safety";

export type ChatMode = "open" | "used" | "paused" | "off";
type Fail = { ok: false; code: "not_found" | "off" | "too_long" | "empty" | "used" | "paused" | "failed" };

async function paused(paid: boolean): Promise<boolean> {
  return !paid && (await freeSpendTodayUsd()) >= dailyCapUsd();
}

export async function chatState(scan: ScanRow): Promise<{ mode: ChatMode; paid: boolean; limit: number; left: number; messages: ChatRow[] }> {
  const paid = !!(await getReportByScanId(scan.id));
  const limit = chatLimit(paid);
  const [asked, messages] = await Promise.all([countQuestions(scan.id), listChat(scan.id)]);
  const left = Math.max(0, limit - asked);
  const mode: ChatMode = !chatEnabled() || scan.status === "failed" ? "off" : left === 0 ? "used" : (await paused(paid)) ? "paused" : "open";
  return { mode, paid, limit, left, messages };
}

export async function askQuestion(scanId: string, question: string, model: ChatModel = chatModelFromEnv()): Promise<{ ok: true; answer: string } | Fail> {
  const scan = await getScan(scanId);
  if (!scan) return { ok: false, code: "not_found" };
  if (!chatEnabled() || scan.status === "failed") return { ok: false, code: "off" };
  const q = question.trim();
  if (!q) return { ok: false, code: "empty" };
  if (q.length > QUESTION_MAX) return { ok: false, code: "too_long" };
  const report = await getReportByScanId(scanId);
  const paid = !!report;
  if (await paused(paid)) return { ok: false, code: "paused" };

  const slot = await reserveQuestion(scanId, q, chatLimit(paid));
  if (slot === null) return { ok: false, code: "used" };
  try {
    const running = scan.status === "queued" || scan.status === "running";
    const raw = running ? null : await getScanRaw(scanId);
    const built = raw ? (paid ? await fullReport(raw, scanId) : buildReport(raw)) : null;
    const [events, history] = await Promise.all([listLiveEvents(scanId, 60), listChat(scanId)]);
    const context = chatContext({ site: siteName(scan.host), report: built, events, running, paid });
    // Earlier turns (without the question just saved), then the question with the data.
    const earlier = history.filter((m) => m.id !== slot).slice(-10).map((m) => ({ role: m.role, content: m.body }));
    // The model's conversation must open with a question.
    while (earlier[0]?.role === "assistant") earlier.shift();
    const res = await model.ask({
      system: CHAT_SYSTEM.replace("{site}", siteName(scan.host)),
      messages: [...earlier, { role: "user", content: `${context}\nQuestion: ${q}` }],
    });
    await chargeAgent(scanId, paid ? "chat_paid" : "chat_free", { model: model.name, usage: res.usage }, `chat-${slot}`);
    const answer = safeAnswer(res.text || "").text;
    if (!res.text) throw new Error("empty answer");
    await saveAnswer(scanId, answer);
    return { ok: true, answer };
  } catch {
    await releaseQuestion(slot);
    return { ok: false, code: "failed" };
  }
}
