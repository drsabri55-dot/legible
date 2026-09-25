import { safeEqual } from "@/lib/crypto";
import { completeScan, failScan, getScan, markScanProgress } from "@/lib/data";
import { alertOwner } from "@/lib/email/send";
import { env } from "@/lib/env";
import { bearer, json } from "@/lib/http";
import { buildReport, freeSummary } from "@/lib/report/model";
import type { RawScan } from "@/types/scan";

export const maxDuration = 30;

type Message =
  | { type: "progress"; pagesDone: number; pagesTotal: number }
  | { type: "complete"; raw: RawScan }
  | { type: "failed"; error: string; detail?: string };

// Called by the scan worker only (shared secret).
export async function POST(req: Request, ctx: RouteContext<"/api/worker/scans/[id]">) {
  if (!safeEqual(bearer(req), env.workerSecret())) return json({ error: "Unauthorised" }, 401);
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return json({ error: "Not found" }, 404);
  const msg = (await req.json().catch(() => null)) as Message | null;
  if (!msg) return json({ error: "Bad request" }, 400);

  if (msg.type === "progress") {
    await markScanProgress(id, Number(msg.pagesDone) || 0, Number(msg.pagesTotal) || null);
    return json({ ok: true });
  }

  if (msg.type === "failed") {
    const code = String(msg.error || "error").slice(0, 40);
    await failScan(id, code);
    if (!["robots", "unreachable", "not_html", "blocked_target"].includes(code)) {
      await alertOwner(`A scan of ${scan.host} failed`, `${code}: ${msg.detail || ""}`, `${env.appUrl()}/scan/${id}`);
    }
    return json({ ok: true });
  }

  if (msg.type === "complete" && msg.raw?.version === 1 && Array.isArray(msg.raw.pages)) {
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
