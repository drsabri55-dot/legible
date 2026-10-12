import "server-only";
import { randomToken } from "./crypto";
import {
  createReportOnce,
  getReportByScanId,
  getReportByToken,
  getScan,
  listFullPages,
  markReportDelivered,
  upsertUser,
  type ReportRow,
} from "./data";
import { alertOwner, sendEmail } from "./email/send";
import { countOf, fullReportEnding, purchasePdfNote, reportStartWith } from "./email/wording";
import { env } from "./env";
import { startFullTest } from "./full";
import { formatUsd } from "./pricing";
import { mergeFullPages } from "./report/full";
import { buildReport } from "./report/model";
import { siteName } from "./url";
import { renderPdf } from "./worker";

export interface PaidScan {
  scanId: string;
  email: string;
  stripeSessionId: string | null;
  amountCents: number;
  currency: string;
}

// Turns a paid scan into a report. Safe to call more than once for the same
// scan: only the first call creates the report and sends the email.
export async function fulfil(paid: PaidScan): Promise<{ report: ReportRow; created: boolean }> {
  const scan = await getScan(paid.scanId);
  if (!scan) throw new Error(`Paid scan ${paid.scanId} not found`);
  if (scan.status !== "complete") throw new Error(`Paid scan ${paid.scanId} is ${scan.status}, not complete`);
  const user = await upsertUser(paid.email);
  return createReportOnce({
    scanId: scan.id,
    userId: user.id,
    token: randomToken(24),
    stripeSessionId: paid.stripeSessionId,
    amountCents: paid.amountCents,
    currency: paid.currency,
  });
}

export function pdfFilename(host: string, date: Date): string {
  return `legible-report-${siteName(host).replace(/[^a-z0-9.-]/gi, "")}-${date.toISOString().slice(0, 10)}.pdf`;
}

// Starts the whole-site test and emails the report link. The PDF waits for
// the email at the end of that test (deliverFullReport); it is attached here
// only when the test could not be set up at all. If the PDF cannot be made,
// the email still goes out with the link, and the owner is told.
export async function deliverReport(report: ReportRow, email: string): Promise<void> {
  const scan = await getScan(report.scan_id);
  if (!scan?.summary) throw new Error(`Report ${report.id} has no scan summary`);
  const base = env.appUrl();
  // A test that could not be sent yet is still running: it is resumed later.
  await startFullTest(report);
  const testing = (await getReportByScanId(report.scan_id))?.full_status === "running";
  let attachments: { filename: string; content: Buffer }[] = [];
  if (!testing) {
    try {
      const pdf = await renderPdf(`/report/${report.token}?print=1`);
      attachments = [{ filename: pdfFilename(scan.host, scan.finished_at ?? new Date()), content: pdf }];
    } catch (e) {
      await alertOwner("A report PDF could not be made", `${scan.host}: ${(e as Error).message}`, `${base}/report/${report.token}`);
    }
  }
  await sendEmail({
    to: email,
    template: "report-ready",
    vars: {
      site: siteName(scan.host),
      score: scan.summary.score ?? "–",
      failures: countOf(scan.summary.totalIssues, "failure"),
      start_with: reportStartWith(scan.summary.groupCounts.must),
      report_link: `${base}/report/${report.token}`,
      account_link: `${base}/account`,
      amount: formatUsd(report.amount_cents),
      pdf_note: purchasePdfNote(testing),
    },
    attachments,
  });
  await markReportDelivered(report.id);
}

// The one email at the end of the whole-site test, with the finished
// report's PDF. If the PDF cannot be made, the email still goes with the link.
export async function deliverFullReport(report: ReportRow, status: "done" | "limit" | "stopped"): Promise<void> {
  const full = await getReportByToken(report.token);
  if (!full) throw new Error(`Report ${report.id} not found`);
  const base = env.appUrl();
  const r = buildReport(mergeFullPages(full.raw, await listFullPages(report.scan_id)));
  let attachments: { filename: string; content: Buffer }[] = [];
  try {
    const pdf = await renderPdf(`/report/${report.token}?print=1`);
    attachments = [{ filename: pdfFilename(full.host, new Date()), content: pdf }];
  } catch (e) {
    await alertOwner("A report PDF could not be made", `${full.host}: ${(e as Error).message}`, `${base}/report/${report.token}`);
  }
  await sendEmail({
    to: full.email,
    template: "full-report-ready",
    vars: {
      site: siteName(full.host),
      pages: countOf(r.pagesScanned, "page"),
      ending: fullReportEnding(status),
      report_link: `${base}/report/${report.token}`,
      account_link: `${base}/account`,
    },
    attachments,
  });
}
