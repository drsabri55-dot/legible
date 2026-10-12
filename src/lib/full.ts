import "server-only";
import {
  claimFullEmail,
  claimNextFullRun,
  finishFullJob,
  getReportByScanId,
  getScan,
  getScanRaw,
  listFullPages,
  paidSpendUsd,
  releaseFullEmail,
  startFullJob,
  unsentFullEmails,
  type ReportRow,
} from "./data";
import { alertOwner } from "./email/send";
import { deliverFullReport } from "./fulfil";
import { AI_FIXES_PER_REPORT, FULL_REPORT_PAGES, aiFixesUsed, mergeFullPages } from "./report/full";
import { buildReport, type Report } from "./report/model";
import { paidAgentOn, reportCapUsd } from "./spend";
import { dispatchFull } from "./worker";
import type { RawScan } from "@/types/scan";

// The paid whole-site test, on the site's side: start (or resume) it, and
// finish it with one email. The worker sends each page to
// /api/worker/full/[id] as it is tested, and says it is alive every few
// minutes while the run waits in its queue or works.

// A run with no news for this long has stopped (the worker restarted, say).
export const QUIET_MINUTES = 20;
export const MAX_ATTEMPTS = 3;

// At purchase: run number 1.
export async function startFullTest(report: ReportRow): Promise<boolean> {
  const attempt = await startFullJob(report.id);
  return dispatchRun(report.scan_id, attempt);
}

async function dispatchRun(scanId: string, attempt: number): Promise<boolean> {
  const scan = await getScan(scanId);
  const raw = await getScanRaw(scanId);
  if (!scan || !raw) return false;
  const stored = await listFullPages(scanId);
  const done = [...raw.pages.filter((p) => p.status === "scanned").map((p) => p.url), ...stored.map((p) => p.url)];
  try {
    await dispatchFull({
      scanId,
      url: raw.finalUrl ?? raw.startUrl,
      done,
      maxPages: FULL_REPORT_PAGES,
      fixesLeft: Math.max(0, AI_FIXES_PER_REPORT - aiFixesUsed(stored)),
      agent: paidAgentOn(),
      attempt,
    });
    return true;
  } catch (e) {
    // Left running: it is resumed once it has been quiet for a while.
    await alertOwner("A whole-site test could not start", `${scan.host}: ${(e as Error).message}`);
    return false;
  }
}

// A claimed next run: finished instead when the report has used its limit,
// or after MAX_ATTEMPTS runs in all; otherwise sent to the worker.
async function nextRun(claimed: ReportRow): Promise<void> {
  if ((await paidSpendUsd(claimed.scan_id)) >= reportCapUsd()) await finishFullTest(claimed.scan_id, "limit");
  else if (claimed.full_attempts > MAX_ATTEMPTS) await finishFullTest(claimed.scan_id, "stopped");
  else await dispatchRun(claimed.scan_id, claimed.full_attempts);
}

// Called when a report is viewed and by the daily cron.
export async function resumeStaleFullTest(report: ReportRow): Promise<void> {
  if (report.full_status !== "running") return;
  const claimed = await claimNextFullRun(report.id, { quietMinutes: QUIET_MINUTES });
  if (claimed) await nextRun(claimed);
}

// The worker said run N failed: try again, unless a newer run already started.
export async function retryAfterError(report: ReportRow, attempt: number): Promise<void> {
  const claimed = await claimNextFullRun(report.id, { fromAttempt: attempt });
  if (claimed) await nextRun(claimed);
}

export async function finishFullTest(scanId: string, status: "done" | "limit" | "stopped"): Promise<void> {
  const report = await getReportByScanId(scanId);
  if (!report || report.full_status === null) return;
  await finishFullJob(report.id, status);
  await sendFullEmailOnce(scanId);
}

// The one email at the end. A send that fails is released, so the daily cron
// tries it again, and the owner is told.
export async function sendFullEmailOnce(scanId: string): Promise<void> {
  const report = await getReportByScanId(scanId);
  if (!report || report.full_status === null || report.full_status === "running") return;
  if (!(await claimFullEmail(report.id))) return;
  try {
    await deliverFullReport(report, report.full_status);
  } catch (e) {
    await releaseFullEmail(report.id);
    await alertOwner("A whole-site report email failed", `${report.id}: ${(e as Error).message}`);
  }
}

export async function retryUnsentFullEmails(minutes: number): Promise<void> {
  for (const report of await unsentFullEmails(minutes)) await sendFullEmailOnce(report.scan_id);
}

// The report as it stands: the free scan plus every page the whole-site test
// has stored so far. buildReport stays pure; this only gathers its input.
export async function fullReport(raw: RawScan, scanId: string): Promise<Report> {
  return buildReport(mergeFullPages(raw, await listFullPages(scanId)));
}
