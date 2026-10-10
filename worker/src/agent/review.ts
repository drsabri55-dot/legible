// A fresh, independent look at each judgement finding: a different prompt,
// no conversation history, the element's real code and a picture of it. A
// finding is kept only when this pass also says it is a problem.
import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { AgentReview, AgentReviewKind, AgentUsage } from "../types";
import { elementInfoScript } from "./dom";
import { emptyUsage, type AgentModel } from "./model";

export const REVIEW_PROMPT = `You are a careful accessibility reviewer. Another reviewer flagged one element on a web page for the problem in the question. Decide on your own whether it is a real problem for a disabled person under WCAG 2.1 Level AA. Answer with the verdict tool. Say problem: false when you are not sure. Keep the reason to one or two short sentences in plain English, written for a small business owner.`;

const VERDICT_TOOL: Anthropic.Tool = {
  name: "verdict",
  description: "Your decision on the flagged element.",
  input_schema: {
    type: "object",
    properties: { problem: { type: "boolean" }, reason: { type: "string" } },
    required: ["problem", "reason"],
    additionalProperties: false,
  },
};

const QUESTION: Record<AgentReviewKind, string> = {
  "image-description": "Does this image's alt text fail to describe what the image shows or means?",
  "link-purpose": "Do this link or button's words, with the text around them, fail to say where it goes or what it does?",
  "heading-fit": "Does this heading fail to describe the section it starts?",
  "error-help": "Does this error message fail to say how to fix the problem?",
  captions: "Does this video lack captions or a transcript?",
};

type Info = { html: string; text: string; around: string; alt: string | null; tag: string };

export async function secondOpinion(
  model: AgentModel,
  page: Page,
  j: { kind: AgentReviewKind; selector: string; reason: string },
  deadline?: number,
): Promise<{ review: AgentReview | null; shot?: Buffer; usage: AgentUsage }> {
  const info = (await page.evaluate(elementInfoScript(j.selector)).catch(() => null)) as Info | null;
  if (!info || !QUESTION[j.kind]) return { review: null, usage: emptyUsage() };
  const el = page.locator(j.selector).first();
  await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const shot = await el.screenshot({ type: "jpeg", quality: 70, timeout: 5000 }).catch(() => undefined);
  const content: Anthropic.ContentBlockParam[] = [];
  if (shot) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: shot.toString("base64") } });
  content.push({
    type: "text",
    // The first reviewer's reason is left out, so this pass judges afresh.
    text: `${QUESTION[j.kind]}\n\nElement code:\n${info.html}\n\nIts text: "${info.text}"\nText around it: "${info.around}"${info.alt !== null ? `\nAlt text: "${info.alt}"` : ""}`,
  });
  const turn = await model.turn({ system: REVIEW_PROMPT, tools: [VERDICT_TOOL], messages: [{ role: "user", content }], deadline });
  const call = turn.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "verdict");
  const input = call?.input as { problem?: unknown; reason?: unknown } | undefined;
  if (!input || input.problem !== true || typeof input.reason !== "string" || !input.reason.trim()) {
    return { review: null, shot, usage: turn.usage };
  }
  return {
    review: { kind: j.kind, selector: j.selector, html: info.html, reason: input.reason.trim().slice(0, 400) },
    shot,
    usage: turn.usage,
  };
}
