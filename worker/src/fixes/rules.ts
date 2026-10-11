// Tries the rule-based fix (the same code the site's report shows) on each
// failing element, and records what happened on the element as `fix`.
import type { Page } from "playwright";
import { completeSnippet, fixKind, suggestFix } from "../rules/fixes";
import type { RawNode, RawRule } from "../types";
import { tryFix } from "./apply";

// The report shows up to 5 examples of each problem.
export const FIX_NODES_PER_RULE = 5;

// Returns the elements whose rule-based fix failed its test. They are left
// without `fix`, so the model can try (see ai.ts) before guidance takes over.
export async function testRuleFixes(page: Page, violations: RawRule[], deadline: number): Promise<RawNode[]> {
  const failed: RawNode[] = [];
  for (const rule of violations) {
    if (rule.id.startsWith("legible-")) continue;
    for (const node of rule.nodes.slice(0, FIX_NODES_PER_RULE)) {
      if (Date.now() > deadline) return failed;
      // Elements inside frames belong to another document.
      if (node.target.length !== 1) continue;
      const html = completeSnippet(node.html);
      const suggested = suggestFix(rule.id, { ...node, html });
      if (!suggested) continue;
      const kind = fixKind(suggested.code);
      const fix = { code: suggested.code, kind, source: "rule" as const };
      if (kind === "note") {
        node.fix = { ...fix, status: "untested" };
        continue;
      }
      const verdict = await tryFix(page, { ruleId: rule.id, selector: node.target[0], html, fix });
      if (verdict === "fail") failed.push(node);
      else node.fix = { ...fix, status: verdict === "pass" ? "tested" : "untested" };
    }
  }
  return failed;
}
