import { safeEqual } from "@/lib/crypto";
import { completeScan, failScan, getScan, markScanProgress, recordScanSpend, saveShots } from "@/lib/data";
import { alertOwner } from "@/lib/email/send";
import { env } from "@/lib/env";
import { bearer, json } from "@/lib/http";
import { buildReport, freeSummary } from "@/lib/report/model";
import { agentPrices, costUsd } from "@/lib/spend";
import type { AgentUsage, RawScan } from "@/types/scan";

export const maxDuration = 30;

type Message =
  | { type: "progress"; pagesDone: number; pagesTotal: number }
  | { type: "complete"; raw: RawScan }
  | { type: "failed"; error: string; detail?: string; agent?: { model: string; usage: AgentUsage } }
  | { type: "shots"; shots: { id: string; data: string }[] };

// Charged once per scan run (the table refuses a repeat), whatever state the
// scan is in, so a late or repeated message can never lose or double spend.
async function recordSpend(scanId: string, agent: { model?: unknown; usage?: Partial<AgentUsage> } | undefined) {
  if (!agent?.usage) return;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  const usage: AgentUsage = {
    inputTokens: n(agent.usage.inputTokens),
    outputTokens: n(agent.usage.outputTokens),
    cacheReadTokens: n(agent.usage.cacheReadTokens),
    cacheWriteTokens: n(agent.usage.cacheWriteTokens),
  };
  const prices = agentPrices();
  await recordScanSpend({
    scanId,
    kind: "free",
    model: String(agent.model || "unknown").slice(0, 80),
    usage,
    costUsd: prices ? costUsd(usage, prices) : null,
  });
}

// Called by the scan worker only (shared secret).
export async function POST(req: Request, ctx: RouteContext<"/api/worker/scans/[id]">) {
  if (!safeEqual(bearer(req), env.workerSecret())) return json({ error: "Unauthorised" }, 401);
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return json({ error: "Not found" }, 404);
  const msg = (await req.json().catch(() => null)) as Message | null;
  if (!msg) return json({ error: "Bad request" }, 400);

  if (msg.type === "shots") {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const list = Array.isArray(msg.shots) ? msg.shots : [];
    const shots = list
      .filter((s) => s && typeof s.id === "string" && UUID.test(s.id) && typeof s.data === "string" && s.data.length < 400_000)
      .slice(0, 200)
      .map((s) => ({ id: s.id.toLowerCase(), jpeg: Buffer.from(s.data, "base64") }))
      .filter((s) => s.jpeg[0] === 0xff && s.jpeg[1] === 0xd8); // JPEG only
    await saveShots(id, shots);
    return json({ ok: true, saved: shots.length });
  }

  if (msg.type === "progress") {
    await markScanProgress(id, Number(msg.pagesDone) || 0, Number(msg.pagesTotal) || null);
    return json({ ok: true });
  }

  if (msg.type === "failed") {
    await recordSpend(id, msg.agent);
    const code = String(msg.error || "error").slice(0, 40);
    await failScan(id, code);
    if (!["robots", "unreachable", "not_html", "blocked_target", "unresolvable", "not_found", "refused"].includes(code)) {
      await alertOwner(`A scan of ${scan.host} failed`, `${code}: ${msg.detail || ""}`, `${env.appUrl()}/scan/${id}`);
    }
    return json({ ok: true });
  }

  if (msg.type === "complete" && msg.raw?.version === 1 && Array.isArray(msg.raw.pages)) {
    await recordSpend(id, msg.raw.agent);
    const report = buildReport(msg.raw);
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
