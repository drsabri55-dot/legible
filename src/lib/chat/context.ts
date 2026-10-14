import type { LiveEventRow } from "../data";
import type { Report } from "../report/model";

const MAX = 16_000;
const PAGES_PER_ISSUE = 5;

// Text from the customer's site loses its angle brackets, so it can never
// open or close the data block, and is cut short.
const clean = (s: string | null | undefined, n: number) =>
  String(s ?? "")
    .replace(/</g, "‹")
    .replace(/>/g, "›")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

// A compact summary of what the scan found, for the chat. The most useful
// lines come first; when it is too long, whole lines are left off the end.
export function chatContext(input: { site: string; report: Report | null; events: LiveEventRow[]; running: boolean; paid: boolean }): string {
  const lines: string[] = [`Site: ${clean(input.site, 200)}`, input.paid ? "The owner bought the full report." : "This is the free scan."];
  if (input.running) lines.push("The scan is still running. Pages not listed below have not been tested yet.");
  const r = input.report;
  if (r) {
    lines.push(`Score: ${r.score ?? "none"} out of 100, across ${r.pagesScanned} pages.`);
    lines.push("Anchors you may link to: #plan" + r.issues.map((i) => ` #issue-${i.ruleId}`).join(""));
    if (r.plan?.steps.length) {
      lines.push("Fix plan, in order:");
      for (const s of r.plan.steps) lines.push(`${s.n}. ${clean(s.title, 120)} (#issue-${s.ruleId})`);
    }
    lines.push("Problems:");
    for (const i of r.issues) {
      const who = i.doer === "you" ? "the owner can fix it" : "needs a developer";
      const shown = i.pages.slice(0, PAGES_PER_ISSUE).map((p) => clean(p.url, 80));
      const more = i.pages.length - shown.length;
      const pages = `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
      lines.push(
        `- ${clean(i.title, 120)} (#issue-${i.ruleId}): ${i.instances} failures on ${i.pages.length} pages, ${i.impact}, ${i.effort} effort, ${who}. ${clean(i.summary, 160)} Fix: ${clean(i.fix, 200)} Pages: ${pages}`,
      );
    }
    if (r.needsReview.length) lines.push(`Check by hand: ${r.needsReview.map((n) => clean(n.title, 80)).join("; ")}`);
  }
  if (input.events.length) {
    lines.push("What the agent did most recently:");
    for (const e of input.events.slice(-40)) lines.push(`- ${clean(e.title, 60)}: ${clean(e.note, 160)}`);
  }
  if (r) lines.push(`Pages tested: ${r.pages.filter((p) => p.status === "scanned").map((p) => clean(p.url, 80)).join(", ")}`);
  const kept: string[] = [];
  let size = 40;
  for (const line of lines) {
    if (size + line.length + 1 > MAX) break;
    kept.push(line);
    size += line.length + 1;
  }
  return `<site_data>\n${kept.join("\n")}\n</site_data>\n`;
}
