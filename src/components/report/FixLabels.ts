// Words for fixes, shared by the free result and the report.
import type { IssueExample } from "@/lib/report/model";
import type { FixKind } from "@/types/scan";

export function fixLabel(ex: Pick<IssueExample, "fixStatus">): string | null {
  if (ex.fixStatus === "tested") return "Tested fix";
  if (ex.fixStatus === "untested") return "Not tested. Check it with your developer";
  return null;
}

export function codeLabel(kind: FixKind | null): string {
  if (kind === "css") return "Add this CSS";
  if (kind === "note") return "Suggested change";
  return "Corrected";
}

export const GUIDANCE_ONLY = "None of the fixes we tried passed our test for this element. Follow How to fix it above.";

export function builderNote(name: string): string {
  return `Your site looks like it is built with ${name}. Make these changes in ${name} or in your theme, or ask whoever looks after the site.`;
}
