import type { LiveEventRow } from "../data";
import type { Report } from "../report/model";

const MAX = 16_000;
const clean = (s: string | null | undefined, n: number) => String(s ?? "").replace(/<\/?site_data>/gi, "").replace(/\s+/g, " ").trim().slice(0, n);

// A compact summary of what the scan found, for the chat. Text from the
// customer's site is cut short and can never close the data block.
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
      const pages = i.pages.map((p) => clean(p.url, 80)).join(", ");
      lines.push(`- ${clean(i.title, 120)} (#issue-${i.ruleId}): ${i.instances} failures, ${i.impact}, ${i.effort} effort, ${who}. ${clean(i.summary, 200)} Fix: ${clean(i.fix, 240)} Pages: ${pages}`);
    }
    if (r.needsReview.length) lines.push(`Check by hand: ${r.needsReview.map((n) => clean(n.title, 80)).join("; ")}`);
  }
  if (input.events.length) {
    lines.push("What the agent did most recently:");
    for (const e of input.events.slice(-40)) lines.push(`- ${clean(e.title, 60)}: ${clean(e.note, 160)}`);
  }
  let body = lines.join("\n");
  if (body.length > MAX - 40) body = body.slice(0, MAX - 40);
  return `<site_data>\n${body}\n</site_data>\n`;
}
