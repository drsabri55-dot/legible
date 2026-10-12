// Words about the paid whole-site test, shown on the report.
import type { FullStatus } from "@/lib/data";
import { FULL_REPORT_PAGES } from "@/lib/report/full";

export function fullTestNote(status: FullStatus | null, pages: number): string | null {
  const word = pages === 1 ? "page" : "pages";
  if (status === "running") {
    return `We are testing the rest of your site. ${pages} of up to ${FULL_REPORT_PAGES} pages so far. This page fills in as we go.`;
  }
  if (status === "limit") return `This report covers ${pages} ${word}. Testing stopped there because it reached its testing limit.`;
  if (status === "stopped") return `This report covers ${pages} ${word}. Testing stopped early because of a problem on our side.`;
  return null;
}

export function welcomeNote(email: string, testing: boolean): string {
  return testing
    ? `Payment received. We are testing the rest of your site now. We will email ${email} when the full report is ready, with the PDF. Bookmark this page: the link is yours to share.`
    : `Payment received. A copy of this report, with the PDF, is on its way to ${email}. Bookmark this page: the link is yours to share.`;
}

// Whether the paid whole-site test is under way. On the Stripe path the buyer
// can land on the report before delivery has started it: a report not yet
// delivered was bought with the whole-site test.
export function wholeSiteTesting(row: { full_status: FullStatus | null; delivered_at: Date | null }): boolean {
  return row.full_status === "running" || (row.full_status === null && !row.delivered_at);
}

export function scopeSentence(wholeSite: boolean, date: string): string {
  return wholeSite
    ? `Legible tested the home page and up to ${FULL_REPORT_PAGES - 1} more pages it found by following the site's links, starting on ${date}.`
    : `Legible scanned the home page and up to five pages linked from its navigation on ${date}.`;
}
