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
