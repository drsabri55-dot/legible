// The testing agent on one page: measure what can be proven, let the model
// use the page with the keyboard, confirm its claims by measurement, give
// its judgements a second opinion, and turn it all into rules the report
// already understands.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { AgentPageResult, AgentReview, AgentReviewKind, RawNode, RawRule } from "../types";
import { AGENT_TOOLS, CLAIM_KINDS, REVIEW_KINDS, pageOutlineScript, perform, type ActionState } from "./actions";
import { guardPage } from "./guard";
import { keyboardWalk, measureFocusAt, measureKeyboardReach, measureReflow, measureTextSpacing, trapFrom, type Measured, type MeasuredKind } from "./measure";
import { addUsage, emptyUsage, type AgentModel } from "./model";
import { SYSTEM_PROMPT, firstMessage } from "./prompts";
import { secondOpinion } from "./review";

export const MAX_STEPS = 20;
export const LOOP_MS = 90_000;
export const AGENT_BUDGET_MS = 180_000;
const MAX_REVIEWS = 10;
const SHOTS_PER_KIND = 3;
const WIDE = { width: 1280, height: 900 };

const UNDERSTANDING = "https://www.w3.org/WAI/WCAG21/Understanding/";
const RULES: Record<MeasuredKind, { impact: string; tags: string[]; help: string; slug: string }> = {
  "keyboard-trap": { impact: "critical", tags: ["wcag2a", "wcag212"], help: "Keyboard focus gets stuck", slug: "no-keyboard-trap" },
  "focus-visible": { impact: "serious", tags: ["wcag2aa", "wcag247"], help: "You cannot see where keyboard focus is", slug: "focus-visible" },
  reflow: { impact: "serious", tags: ["wcag21aa", "wcag1410"], help: "The page needs sideways scrolling at 400% zoom", slug: "reflow" },
  "keyboard-reach": { impact: "serious", tags: ["wcag2a", "wcag211"], help: "Something clickable cannot be reached with the keyboard", slug: "keyboard" },
  "text-spacing": { impact: "moderate", tags: ["wcag21aa", "wcag1412"], help: "Text is cut off when spacing is increased", slug: "text-spacing" },
};
// Measurements that can prove a failure. A page where they ran and found
// nothing passes them, so the score counts them like axe-core rules.
const SCORED: MeasuredKind[] = ["keyboard-trap", "focus-visible", "reflow"];

export interface AgentOptions {
  model: AgentModel;
  maxSteps?: number;
  loopMs?: number;
  budgetMs?: number;
  onShot?: (id: string, jpeg: Buffer) => void | Promise<void>;
}

export interface AgentOutcome {
  result: AgentPageResult;
  violations: RawRule[];
  incomplete: RawRule[];
  passes: { id: string; nodeCount: number }[];
}

function summaryLine(m: Measured): string {
  return `${m.kind}: ${m.selector} (${m.verdict === "fail" ? "failure" : "check by hand"})`;
}

// One finding per kind and element; a failure beats a hand check.
function dedupe(found: Measured[]): Measured[] {
  const byKey = new Map<string, Measured>();
  for (const m of found) {
    const key = `${m.kind}\u0000${m.selector}`;
    const had = byKey.get(key);
    if (!had || (had.verdict === "review" && m.verdict === "fail")) byKey.set(key, m);
  }
  return [...byKey.values()];
}

async function toRules(found: Measured[], onShot: AgentOptions["onShot"]) {
  const violations: RawRule[] = [];
  const incomplete: RawRule[] = [];
  for (const verdict of ["fail", "review"] as const) {
    for (const kind of Object.keys(RULES) as MeasuredKind[]) {
      const hits = found.filter((m) => m.kind === kind && m.verdict === verdict);
      if (!hits.length) continue;
      const r = RULES[kind];
      const nodes: RawNode[] = [];
      for (const [i, m] of hits.entries()) {
        const node: RawNode = { html: m.html, target: [m.selector], failureSummary: m.detail, impact: r.impact };
        if (m.shot && onShot && i < SHOTS_PER_KIND) {
          node.shot = randomUUID();
          await onShot(node.shot, m.shot);
        }
        nodes.push(node);
      }
      const rule: RawRule = {
        id: `legible-${kind}`,
        impact: r.impact,
        help: r.help,
        description: r.help,
        helpUrl: `${UNDERSTANDING}${r.slug}.html`,
        tags: r.tags,
        nodeCount: nodes.length,
        nodes,
      };
      (verdict === "fail" ? violations : incomplete).push(rule);
    }
  }
  const failed = new Set(violations.map((v) => v.id));
  const passes = SCORED.map((k) => `legible-${k}`)
    .filter((id) => !failed.has(id))
    .map((id) => ({ id, nodeCount: 1 }));
  return { violations, incomplete, passes };
}

export async function runAgentOnPage(page: Page, opts: AgentOptions): Promise<AgentOutcome> {
  const started = Date.now();
  const budgetEnd = started + (opts.budgetMs ?? AGENT_BUDGET_MS);
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  const url = page.url();
  let usage = emptyUsage();
  const found: Measured[] = [];
  const judged: { kind: AgentReviewKind; selector: string; reason: string }[] = [];
  const reviews: AgentReview[] = [];
  let steps = 0;
  let status: AgentPageResult["status"] = "tested";
  let reason: string | undefined;
  const state: ActionState = { url, zoomed: false, spaced: false };
  const release = await guardPage(page);
  try {
    // 1. Measure what can be proven on the page as it loaded.
    const walk = await keyboardWalk(page);
    found.push(...walk.findings);
    found.push(...(await measureKeyboardReach(page, walk.reached)));
    found.push(...(await measureReflow(page)));
    found.push(...(await measureTextSpacing(page)));
    await page.evaluate("document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)");

    // 2. Let the model use the page.
    const loopEnd = Math.min(budgetEnd, Date.now() + (opts.loopMs ?? LOOP_MS));
    const outline = (await page.evaluate(pageOutlineScript()).catch(() => "")) as string;
    const messages: Anthropic.MessageParam[] = [
      firstMessage(url, dedupe(found).map(summaryLine), outline, await page.screenshot({ type: "jpeg", quality: 60 })),
    ];
    loop: while (true) {
      if (Date.now() >= loopEnd) {
        status = "partly";
        reason = "time limit";
        break;
      }
      let turn;
      try {
        turn = await opts.model.turn({ system: SYSTEM_PROMPT, tools: AGENT_TOOLS, messages });
      } catch {
        status = "failed";
        reason = "model error";
        break;
      }
      usage = addUsage(usage, turn.usage);
      if (turn.stopReason === "refusal") {
        status = "failed";
        reason = "declined";
        break;
      }
      const calls = turn.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!calls.length) break;
      messages.push({ role: "assistant", content: turn.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        if (steps >= maxSteps) {
          status = "partly";
          reason = "step limit";
          break loop;
        }
        steps++;
        const input = (call.input ?? {}) as Record<string, unknown>;
        if (call.name === "done") break loop;
        if (call.name === "claim") {
          const kind = input.kind as string;
          const selector = typeof input.selector === "string" ? input.selector : "";
          let m: Measured | null = null;
          if (kind === "focus-visible") m = await measureFocusAt(page, selector);
          else if (kind === "keyboard-trap") m = await trapFrom(page, selector);
          if (!CLAIM_KINDS.includes(kind as (typeof CLAIM_KINDS)[number])) {
            results.push({ type: "tool_result", tool_use_id: call.id, content: `Unknown claim kind: ${kind}.`, is_error: true });
          } else if (m) {
            found.push(m);
            results.push({ type: "tool_result", tool_use_id: call.id, content: `Measured and confirmed: ${m.detail}` });
          } else {
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Measured: the problem could not be proven there, so it is not reported." });
          }
          continue;
        }
        if (call.name === "judge") {
          const kind = input.kind as AgentReviewKind;
          if (!REVIEW_KINDS.includes(kind) || typeof input.selector !== "string" || typeof input.reason !== "string") {
            results.push({ type: "tool_result", tool_use_id: call.id, content: "judge needs a listed kind, a selector and a reason.", is_error: true });
          } else {
            judged.push({ kind, selector: input.selector, reason: input.reason });
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Noted. A second check will decide whether it is reported." });
          }
          continue;
        }
        const r = await perform(page, call.name, input, state);
        const content: Anthropic.ToolResultBlockParam["content"] = [{ type: "text", text: r.text }];
        if (r.image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.image.toString("base64") } });
        results.push({ type: "tool_result", tool_use_id: call.id, content, ...(r.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
    }

    // 3. Put the page back as it loaded, then the second opinions.
    if (state.zoomed) await page.setViewportSize(WIDE).catch(() => {});
    await page.evaluate("(function () { var s = document.getElementById('legible-text-spacing'); if (s) s.remove(); })()").catch(() => {});
    if (status !== "failed") {
      const seen = new Set<string>();
      for (const j of judged) {
        const key = `${j.kind}\u0000${j.selector}`;
        if (seen.has(key) || seen.size >= MAX_REVIEWS || Date.now() >= budgetEnd) continue;
        seen.add(key);
        try {
          const op = await secondOpinion(opts.model, page, j);
          usage = addUsage(usage, op.usage);
          if (op.review) {
            if (op.shot && opts.onShot) {
              op.review.shot = randomUUID();
              await opts.onShot(op.review.shot, op.shot);
            }
            reviews.push(op.review);
          }
        } catch {
          // A failed second opinion means the finding is not confirmed.
        }
      }
    }
  } finally {
    if (state.zoomed) await page.setViewportSize(WIDE).catch(() => {});
    await release();
  }
  const rules = await toRules(dedupe(found), opts.onShot);
  return { result: { status, ...(reason ? { reason } : {}), steps, reviews, usage }, ...rules };
}
