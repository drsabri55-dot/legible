import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentReview, ElementShot, agentMethod, agentPageNote } from "@/components/report/AgentSections";
import { buildReport } from "@/lib/report/model";
import { page, rawScan } from "./fixture";

const report = (agent: boolean) =>
  buildReport(
    rawScan([
      page("https://www.shop.example/", [], ["image-alt"], agent
        ? { agent: { status: "failed", reason: "model error", steps: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, reviews: [{ kind: "link-purpose", selector: "#more", html: '<a id="more">Click here</a>', reason: "The link says only click here.", shot: "66666666-6666-4666-8666-666666666666" }] } }
        : {}),
    ]),
  );

describe("report sections for the testing agent", () => {
  it("lists the agent's review with its reasoning, code and screenshot", () => {
    const html = renderToStaticMarkup(createElement(AgentReview, { r: report(true) }));
    expect(html).toContain("The agent’s review"); // &rsquo; renders as the character itself
    expect(html).toContain("A link or button may not say where it goes");
    expect(html).toContain("The link says only click here.");
    expect(html).toContain("/api/shots/66666666-6666-4666-8666-666666666666");
    expect(html).toContain("not counted in the score");
    expect(html).not.toMatch(/compliant|legally safe/i);
  });

  it("shows nothing when the agent found nothing to review", () => {
    expect(renderToStaticMarkup(createElement(AgentReview, { r: report(false) }))).toBe("");
  });

  it("explains pages the agent could not finish, and how it worked", () => {
    const r = report(true);
    expect(agentPageNote(r.pages[0])).toBe("The testing agent could not finish this page. Its other checks are complete.");
    expect(agentMethod(r)).toContain("keyboard only");
    expect(agentMethod(report(false))).toBeNull();
  });

  it("gives each screenshot a text alternative", () => {
    const html = renderToStaticMarkup(createElement(ElementShot, { id: "66666666-6666-4666-8666-666666666666", label: "#more" }));
    expect(html).toMatch(/alt="Screenshot of the element #more"/);
    expect(renderToStaticMarkup(createElement(ElementShot, { id: null, label: "x" }))).toBe("");
  });
});
