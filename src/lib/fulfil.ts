import "server-only";
import { randomToken } from "./crypto";
import { createReportOnce, getScan, markReportDelivered, upsertUser, type ReportRow } from "./data";
import { alertOwner, sendEmail } from "./email/send";
import { env } from "./env";
import { formatUsd } from "./pricing";
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
  return `legible-report-${host.replace(/[^a-z0-9.-]/gi, "")}-${date.toISOString().slice(0, 10)}.pdf`;
}

// Emails the report with the PDF attached. If the PDF cannot be made, the
// email still goes out with the link, and the owner is told.
export async function deliverReport(report: ReportRow, email: string): Promise<void> {
  const scan = await getScan(report.scan_id);
  if (!scan?.summary) throw new Error(`Report ${report.id} has no scan summary`);
  const base = env.appUrl();
  let attachments: { filename: string; content: Buffer }[] = [];
  try {
    const pdf = await renderPdf(`/report/${report.token}?print=1`);
    attachments = [{ filename: pdfFilename(scan.host, scan.finished_at ?? new Date()), content: pdf }];
  } catch (e) {
    await alertOwner("A report PDF could not be made", `${scan.host}: ${(e as Error).message}`, `${base}/report/${report.token}`);
  }
  await sendEmail({
    to: email,
    template: "report-ready",
    vars: {
      site: scan.host,
      score: scan.summary.score ?? "–",
      total: scan.summary.totalIssues,
      must: scan.summary.groupCounts.must,
      report_link: `${base}/report/${report.token}`,
      account_link: `${base}/account`,
      amount: formatUsd(report.amount_cents),
    },
    attachments,
  });
  await markReportDelivered(report.id);
}
