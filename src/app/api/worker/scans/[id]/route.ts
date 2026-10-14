import { safeEqual } from "@/lib/crypto";
import { addLiveEvent, completeScan, deleteLiveFrame, failScan, getScan, markScanProgress, saveLiveFrame } from "@/lib/data";
import { alertOwner } from "@/lib/email/send";
import { env } from "@/lib/env";
import { bearer, json } from "@/lib/http";
import { frameBytes, isLiveMessage, type LiveMessage } from "@/lib/live";
import { buildReport, freeSummary } from "@/lib/report/model";
import { saveWorkerShots } from "@/lib/shots";
import { chargeAgent } from "@/lib/spend";
import type { AgentUsage, RawScan } from "@/types/scan";

export const maxDuration = 30;

type Message =
  | { type: "progress"; pagesDone: number; pagesTotal: number }
  | { type: "complete"; raw: RawScan }
  | { type: "failed"; error: string; detail?: string; agent?: { model: string; usage: AgentUsage } }
  | { type: "shots"; shots: { id: string; data: string }[] }
  | LiveMessage;

// Called by the scan worker only (shared secret).
export async function POST(req: Request, ctx: RouteContext<"/api/worker/scans/[id]">) {
  if (!safeEqual(bearer(req), env.workerSecret())) return json({ error: "Unauthorised" }, 401);
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return json({ error: "Not found" }, 404);
  const msg = (await req.json().catch(() => null)) as Message | null;
  if (!msg) return json({ error: "Bad request" }, 400);

  // What the agent is doing, for the live view. Only while the scan runs.
  if (msg.type === "live") {
    if (!isLiveMessage(msg)) return json({ error: "Bad request" }, 400);
    const frame = msg.frame === undefined ? null : frameBytes(msg.frame);
    if (msg.frame !== undefined && !frame) return json({ error: "Bad frame" }, 400);
    if (scan.status !== "running" && scan.status !== "queued") return json({ ok: true, ignored: true });
    await addLiveEvent(id, { step: msg.step, page: msg.page, title: msg.title ?? null, kind: msg.kind, note: msg.note });
    if (frame) await saveLiveFrame(id, frame, msg.note);
    return json({ ok: true });
  }

  if (msg.type === "shots") {
    return json({ ok: true, saved: await saveWorkerShots(id, msg.shots) });
  }

  if (msg.type === "progress") {
    await markScanProgress(id, Number(msg.pagesDone) || 0, Number(msg.pagesTotal) || null);
    return json({ ok: true });
  }

  if (msg.type === "failed") {
    await chargeAgent(id, "free", msg.agent);
    const code = String(msg.error || "error").slice(0, 40);
    await failScan(id, code);
    await deleteLiveFrame(id);
    if (!["robots", "unreachable", "not_html", "blocked_target", "unresolvable", "not_found", "refused"].includes(code)) {
      await alertOwner(`A scan of ${scan.host} failed`, `${code}: ${msg.detail || ""}`, `${env.appUrl()}/scan/${id}`);
    }
    return json({ ok: true });
  }

  if (msg.type === "complete" && msg.raw?.version === 1 && Array.isArray(msg.raw.pages)) {
    await chargeAgent(id, "free", msg.raw.agent);
    const report = buildReport(msg.raw);
    // The latest picture is only for the live view; the events stay for the chat.
    await deleteLiveFrame(id);
    if (report.pagesScanned === 0) {
      await failScan(id, "unreachable");
      return json({ ok: true });
    }
    await completeScan(id, {
      raw: msg.raw,
      score: report.score,
      summary: freeSummary(report),
      pagesDone: report.pagesScanned,
    });
    return json({ ok: true });
  }

  return json({ error: "Bad request" }, 400);
}
