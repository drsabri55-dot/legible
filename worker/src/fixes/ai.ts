// The model writes a fix for a failure that has no working rule-based fix.
// It sees the failing element's code, its computed styles and the failure.
// Its fix is tried in the browser like any other (apply.ts); a fix that
// still fails gets one more try, then nothing is kept.
import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { AgentModel } from "../agent/model";
import type { FixKind, NodeFix } from "../types";
import { MAX_FIX_CHARS, tryFix } from "./apply";

export const AI_FIXES_PER_SCAN = 40;

export const FIX_PROMPT = `You fix one accessibility failure on a web page. You get the failing element's code, its computed styles and the failure. Answer with the fix tool only. Prefer the smallest change. Use kind css for a stylesheet rule that targets the element's selector, html for the element rewritten in full (one element), and note when the change has to be made in a script, on the server or in a content management system. Never invent content: put text only the owner can write in [square brackets]. Keep note to one or two short sentences in plain English for a small business owner, in British spelling.`;

export const FIX_TOOL: Anthropic.Tool = {
  name: "fix",
  description: "Your fix for the failing element.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["html", "css", "note"] },
      code: { type: "string", description: "The CSS rule, the rewritten element, or the change to make." },
      note: { type: "string", description: "What the fix does, in one or two short sentences." },
    },
    required: ["kind", "code", "note"],
    additionalProperties: false,
  },
};

const STYLES = [
  "color", "background-color", "font-size", "font-weight", "display", "position", "outline", "outline-offset",
  "width", "max-width", "height", "overflow", "white-space",
];

const CONTEXT = (selector: string) => `(function (sel) {
  var e;
  try { e = document.querySelector(sel); } catch (x) { return null; }
  if (!e) return null;
  var s = getComputedStyle(e), styles = {};
  ${JSON.stringify(STYLES)}.forEach(function (p) { styles[p] = s.getPropertyValue(p); });
  return { html: e.outerHTML.slice(0, 4000), styles: styles };
})(${JSON.stringify(selector)})`;

export interface Failure {
  ruleId: string;
  help: string;
  summary: string;
  selector: string;
}

type Answer = { kind: FixKind; code: string; note: string; id: string };

function readAnswer(content: Anthropic.ContentBlock[]): Answer | null {
  const call = content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "fix");
  const input = call?.input as { kind?: unknown; code?: unknown; note?: unknown } | undefined;
  if (!call || !input || typeof input.code !== "string" || !input.code.trim() || input.code.length > MAX_FIX_CHARS) return null;
  if (input.kind !== "html" && input.kind !== "css" && input.kind !== "note") return null;
  return { kind: input.kind, code: input.code.trim(), note: typeof input.note === "string" ? input.note.trim().slice(0, 400) : "", id: call.id };
}

export async function writeFix(model: AgentModel, page: Page, failure: Failure, deadline: number): Promise<NodeFix | null> {
  if (Date.now() >= deadline) return null;
  const info = (await page.evaluate(CONTEXT(failure.selector)).catch(() => null)) as
    | { html: string; styles: Record<string, string> }
    | null;
  if (!info) return null;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Failure: ${failure.help} (${failure.ruleId}).\n${failure.summary}\n\nSelector: ${failure.selector}\n\nElement code:\n${info.html}\n\nComputed styles:\n${Object.entries(info.styles).map(([k, v]) => `${k}: ${v}`).join("\n")}`,
    },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() >= deadline) return null;
    let turn;
    try {
      turn = await model.turn({ system: FIX_PROMPT, tools: [FIX_TOOL], messages, deadline });
    } catch {
      return null;
    }
    const a = readAnswer(turn.content);
    if (!a) return null;
    const fix = { code: a.code, kind: a.kind, source: "ai" as const, ...(a.note ? { note: a.note } : {}) };
    if (a.kind === "note") return { ...fix, status: "untested" };
    const verdict = await tryFix(page, { ruleId: failure.ruleId, selector: failure.selector, html: info.html, fix: a, replace: true });
    if (verdict === "pass") return { ...fix, status: "tested" };
    // Markup or CSS that cannot even be applied here is not a usable fix.
    if (verdict === "untestable") return null;
    if (verdict === "unknown") return { ...fix, status: "untested" };
    messages.push({ role: "assistant", content: turn.content as Anthropic.ContentBlockParam[] });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: a.id, content: "That fix was applied and the same check still fails. Try a different fix." }],
    });
  }
  return null;
}
