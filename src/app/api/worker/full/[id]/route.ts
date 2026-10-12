import { safeEqual } from "@/lib/crypto";
import { countFullPages, getReportByScanId, paidSpendUsd, saveFullPage, touchFullJob } from "@/lib/data";
import { env } from "@/lib/env";
import { finishFullTest, retryOrFinish } from "@/lib/full";
import { bearer, json } from "@/lib/http";
import { saveWorkerShots } from "@/lib/shots";
import { chargeAgent, reportCapUsd } from "@/lib/spend";
import type { AgentUsage, RawPage } from "@/types/scan";

export const maxDuration = 60;

type Agent = { model: string; usage: AgentUsage };
type Message =
  | { type: "shots"; shots: unknown }
  | { type: "page"; page: RawPage; agent?: Agent }
  | { type: "done"; reason: "done" | "limit" | "stopped" | "error"; tested: number; agent?: Agent };

function isPage(p: unknown): p is RawPage {
  const v = p as RawPage | null;
  return (
    !!v &&
    typeof v.url === "string" &&
    /^https?:\/\//.test(v.url) &&
    v.url.length <= 2000 &&
    v.status === "scanned" &&
    Array.isArray(v.violations) &&
    Array.isArray(v.incomplete) &&
    Array.isArray(v.passes)
  );
}

// Called by the worker only (shared secret), once per tested page of a paid
// whole-site test, and once at its end. The answer to a page says whether to
// stop: the report has reached its spending limit, or the run is over.
export async function POST(req: Request, ctx: RouteContext<"/api/worker/full/[id]">) {
  if (!safeEqual(bearer(req), env.workerSecret())) return json({ error: "Unauthorised" }, 401);
  const { id } = await ctx.params;
  const report = await getReportByScanId(id);
  if (!report || report.full_status === null) return json({ error: "Not found" }, 404);
  const msg = (await req.json().catch(() => null)) as Message | null;
  if (!msg) return json({ error: "Bad request" }, 400);

  if (msg.type === "shots") return json({ ok: true, saved: await saveWorkerShots(id, msg.shots) });

  if (msg.type === "page") {
    if (!isPage(msg.page)) return json({ error: "Bad request" }, 400);
    await saveFullPage(id, msg.page.url, msg.page);
    await chargeAgent(id, "paid", msg.agent, msg.page.url);
    await touchFullJob(report.id, await countFullPages(id));
    const stop = report.full_status !== "running" || (await paidSpendUsd(id)) >= reportCapUsd();
    return json({ ok: true, stop });
  }

  if (msg.type === "done") {
    // What the agent used after the last page, charged once per run.
    await chargeAgent(id, "paid", msg.agent, `rest-${report.full_attempts}`);
    if (report.full_status !== "running") return json({ ok: true });
    if (msg.reason === "error") {
      await retryOrFinish(report);
      return json({ ok: true });
    }
    const limited = (await paidSpendUsd(id)) >= reportCapUsd();
    await finishFullTest(id, limited ? "limit" : "done");
    return json({ ok: true });
  }

  return json({ error: "Bad request" }, 400);
}
