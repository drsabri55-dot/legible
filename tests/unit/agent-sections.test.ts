import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentReview, ElementShot, agentMethod, agentPageNote, axeRuleCounts } from "@/components/report/AgentSections";
import { AgentCapNote, scanTimeText, slowAfterMs } from "@/components/results/AgentNote";
import { buildReport } from "@/lib/report/model";
import { page, rawScan, rule } from "./fixture";

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

  it("names the real reason a page was only partly tested", () => {
    const note = (reason: string) =>
      agentPageNote({ url: "u", title: null, status: "scanned", reason: null, issues: 0, agent: { status: "partly", reason } });
    expect(note("time limit")).toBe("The testing agent reached its time limit on this page, so it tested part of it.");
    expect(note("step limit")).toBe("The testing agent used all its steps on this page, so it tested part of it.");
  });

  it("counts axe-core rules apart from the agent's own checks", () => {
    const focus = rule("legible-focus-visible", "serious", ["<a>x</a>"], ["wcag2aa", "wcag247"]);
    const alt = rule("image-alt", "critical", ["<img>"]);
    const r = buildReport(rawScan([page("https://www.shop.example/", [focus, alt], ["label", "legible-reflow", "legible-keyboard-trap"])]));
    expect(axeRuleCounts(r)).toEqual({ passed: 1, failed: 1 });
  });
});


describe("what visitors see about the daily cap", () => {
  it("says so only when the cap left the agent out", () => {
    expect(renderToStaticMarkup(createElement(AgentCapNote, { mode: "capped" }))).toContain("reached its limit for today");
    expect(renderToStaticMarkup(createElement(AgentCapNote, { mode: "on" }))).toBe("");
    expect(renderToStaticMarkup(createElement(AgentCapNote, { mode: "off" }))).toBe("");
  });

  it("gives the longer scan time only when the agent runs", () => {
    expect(scanTimeText(true)).toContain("3 to 6 minutes");
    expect(scanTimeText(false)).toContain("under two minutes");
  });

  it("only calls a scan slow once it passes its usual time", () => {
    expect(slowAfterMs(false)).toBe(90_000);
    expect(slowAfterMs(true)).toBe(7 * 60_000);
  });
});
