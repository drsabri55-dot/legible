import "server-only";
import {
  claimFullEmail,
  finishFullJob,
  getReportByScanId,
  getScan,
  getScanRaw,
  listFullPages,
  startFullJob,
  type ReportRow,
} from "./data";
import { alertOwner } from "./email/send";
import { deliverFullReport } from "./fulfil";
import { AI_FIXES_PER_REPORT, FULL_REPORT_PAGES, aiFixesUsed } from "./report/full";
import { paidAgentOn } from "./spend";
import { dispatchFull } from "./worker";

// The paid whole-site test, on the site's side: start (or resume) it, and
// finish it with one email. The worker sends each page to
// /api/worker/full/[id] as it is tested.

// A run with no news for this long has stopped (the worker restarted, say).
export const QUIET_MINUTES = 20;
export const MAX_ATTEMPTS = 3;

export async function startFullTest(report: ReportRow): Promise<boolean> {
  const scan = await getScan(report.scan_id);
  const raw = await getScanRaw(report.scan_id);
  if (!scan || !raw) return false;
  const stored = await listFullPages(scan.id);
  const done = [...raw.pages.filter((p) => p.status === "scanned").map((p) => p.url), ...stored.map((p) => p.url)];
  await startFullJob(report.id);
  try {
    await dispatchFull({
      scanId: scan.id,
      url: raw.finalUrl ?? raw.startUrl,
      done,
      maxPages: FULL_REPORT_PAGES,
      fixesLeft: Math.max(0, AI_FIXES_PER_REPORT - aiFixesUsed(stored)),
      agent: paidAgentOn(),
    });
    return true;
  } catch (e) {
    // Left running: it is resumed once it has been quiet for a while.
    await alertOwner("A whole-site test could not start", `${scan.host}: ${(e as Error).message}`);
    return false;
  }
}

// Called when a report is viewed and by the daily cron.
export async function resumeStaleFullTest(report: ReportRow): Promise<void> {
  if (report.full_status !== "running" || !report.full_updated_at) return;
  if (Date.now() - new Date(report.full_updated_at).getTime() < QUIET_MINUTES * 60_000) return;
  await retryOrFinish(report);
}

// After a failed or lost run: try again, up to MAX_ATTEMPTS in all.
export async function retryOrFinish(report: ReportRow): Promise<void> {
  if (report.full_attempts >= MAX_ATTEMPTS) await finishFullTest(report.scan_id, "stopped");
  else await startFullTest(report);
}

export async function finishFullTest(scanId: string, status: "done" | "limit" | "stopped"): Promise<void> {
  const report = await getReportByScanId(scanId);
  if (!report || report.full_status === null) return;
  await finishFullJob(report.id, status);
  if (!(await claimFullEmail(report.id))) return;
  const ended = (await getReportByScanId(scanId))?.full_status ?? status;
  await deliverFullReport(report, ended === "running" ? status : ended);
}
