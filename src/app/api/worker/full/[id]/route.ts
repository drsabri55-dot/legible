import { after } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { aliveFullJob, countFullPages, finishFullJob, getReportByScanId, getScan, paidSpendUsd, saveFullPage, touchFullJob } from "@/lib/data";
import { env } from "@/lib/env";
import { retryAfterError, sendFullEmailOnce } from "@/lib/full";
import { bearer, json } from "@/lib/http";
import { FULL_REPORT_PAGES } from "@/lib/report/full";
import { saveWorkerShots } from "@/lib/shots";
import { agentPrices, chargeAgent, reportCapUsd } from "@/lib/spend";
import type { AgentUsage, RawPage } from "@/types/scan";

export const maxDuration = 60;

type Agent = { model: string; usage: AgentUsage };
type Message = { attempt?: unknown } & (
  | { type: "shots"; shots: unknown }
  | { type: "alive" }
  | { type: "page"; page: RawPage; agent?: Agent }
  | { type: "done"; reason: "done" | "limit" | "stopped" | "error"; tested: number; agent?: Agent }
);

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

// Work that may take a while (the email renders a PDF) runs after the answer,
// so the worker is never kept waiting. Outside a request (tests) it just runs.
function later(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

// Called by the worker only (shared secret), while a paid whole-site test runs.
// Every message carries its run's number: messages from an older run are
// charged for what they used and otherwise ignored. The answer says whether to
// stop: the run is over or replaced, 50 pages are done, or the report has
// reached its spending limit.
export async function POST(req: Request, ctx: RouteContext<"/api/worker/full/[id]">) {
  if (!safeEqual(bearer(req), env.workerSecret())) return json({ error: "Unauthorised" }, 401);
  const { id } = await ctx.params;
  const report = await getReportByScanId(id);
  if (!report || report.full_status === null) return json({ error: "Not found" }, 404);
  const msg = (await req.json().catch(() => null)) as Message | null;
  if (!msg) return json({ error: "Bad request" }, 400);
  const attempt = Number(msg.attempt);
  const current = report.full_status === "running" && attempt === report.full_attempts;

  if (msg.type === "shots") return json({ ok: true, saved: await saveWorkerShots(id, msg.shots) });

  if (msg.type === "alive") {
    if (current) await aliveFullJob(report.id);
    return json({ ok: true, stop: !current });
  }

  if (msg.type === "page") {
    if (!isPage(msg.page)) return json({ error: "Bad request" }, 400);
    // What the agent used is charged whichever run it came from.
    await chargeAgent(id, "paid", msg.agent, msg.page.url);
    if (!current) return json({ ok: true, stop: true });
    await saveFullPage(id, msg.page.url, msg.page);
    const stored = await countFullPages(id);
    await touchFullJob(report.id, stored);
    const freePages = (await getScan(id))?.pages_done ?? 0;
    const stop =
      freePages + stored >= FULL_REPORT_PAGES ||
      (await paidSpendUsd(id)) >= reportCapUsd() ||
      // Spend that cannot be priced cannot be kept under the limit.
      (!!msg.agent && !agentPrices());
    return json({ ok: true, stop });
  }

  if (msg.type === "done") {
    // What the agent used after the last page, charged once per run.
    await chargeAgent(id, "paid", msg.agent, `rest-${Number.isFinite(attempt) ? attempt : "x"}`);
    if (!current) return json({ ok: true });
    if (msg.reason === "error") {
      later(() => retryAfterError(report, attempt));
      return json({ ok: true });
    }
    const limited = (await paidSpendUsd(id)) >= reportCapUsd();
    await finishFullJob(report.id, limited ? "limit" : "done");
    later(() => sendFullEmailOnce(id));
    return json({ ok: true });
  }

  return json({ error: "Bad request" }, 400);
}
