// How tested fixes and the fix plan read on the free result and the report.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GUIDANCE_ONLY, builderNote, codeLabel, fixLabel } from "@/components/report/FixLabels";
import { FixPlan } from "@/components/results/FixPlan";
import { IssueDetail } from "@/components/results/IssueDetail";
import { buildReport, type Issue } from "@/lib/report/model";
import { page, rawScan, rule } from "./fixture";

function issueWith(fix: unknown): Issue {
  const raw = rawScan([page("https://www.shop.example/", [rule("image-alt", "critical", ['<img src="a.jpg">'])], [])]);
  raw.fixVersion = 1;
  (raw.pages[0].violations[0].nodes[0] as { fix?: unknown }).fix = fix;
  return buildReport(raw).issues[0];
}

describe("fix labels", () => {
  it("say whether a fix was tested", () => {
    expect(fixLabel(issueWith({ code: "<img alt>", kind: "html", status: "tested", source: "rule" }).examples[0])).toBe("Tested fix");
    expect(fixLabel(issueWith({ code: "x", kind: "note", status: "untested", source: "ai" }).examples[0])).toBe(
      "Not tested. Check it with your developer",
    );
    expect(fixLabel({ ...issueWith(undefined).examples[0], fixStatus: null })).toBeNull();
  });

  it("name the kind of change", () => {
    expect(codeLabel("css")).toBe("Add this CSS");
    expect(codeLabel("note")).toBe("Suggested change");
    expect(codeLabel("html")).toBe("Corrected");
    expect(codeLabel(null)).toBe("Corrected");
  });

  it("name the website builder without giving steps for it", () => {
    expect(builderNote("Shopify")).toBe(
      "Your site looks like it is built with Shopify. Make these changes in Shopify or in your theme, or ask whoever looks after the site.",
    );
  });
});

describe("one problem on the free result", () => {
  it("shows a tested fix as tested, with an anchor for the plan", () => {
    const html = renderToStaticMarkup(createElement(IssueDetail, { issue: issueWith({ code: '<img src="a.jpg" alt="[Describe the image]">', kind: "html", status: "tested", source: "rule" }) }));
    expect(html).toContain('id="issue-image-alt"');
    expect(html).toContain("Tested fix");
    expect(html).toContain("Corrected");
  });

  it("shows an untested AI change as not tested", () => {
    const html = renderToStaticMarkup(createElement(IssueDetail, { issue: issueWith({ code: "Change the gallery script.", kind: "note", status: "untested", source: "ai" }) }));
    expect(html).toContain("Not tested. Check it with your developer");
    expect(html).toContain("Suggested change");
  });

  it("gives guidance only, with no code, when every fix failed", () => {
    const html = renderToStaticMarkup(createElement(IssueDetail, { issue: issueWith(null) }));
    expect(html).toContain(GUIDANCE_ONLY);
    expect(html).not.toContain("General example");
  });
});

describe("the fix plan on the free result", () => {
  it("lists the steps in order, linking to each problem", () => {
    const raw = rawScan([
      page("https://www.shop.example/", [
        rule("color-contrast", "serious", ["<p>x</p>"], ["wcag2aa", "wcag143"]),
        rule("image-alt", "critical", ['<img src="a.jpg">', '<img src="b.jpg">']),
      ], []),
    ]);
    raw.builtWith = "Wix";
    const r = buildReport(raw);
    const html = renderToStaticMarkup(createElement(FixPlan, { plan: r.plan, builtWith: r.builtWith }));
    expect(html).toContain("Your fix plan");
    expect(html).toContain("2 steps, about 1 to 2 hours in total. 1 you can do yourself, 1 needs a developer.");
    expect(html.indexOf('href="#issue-image-alt"')).toBeLessThan(html.indexOf('href="#issue-color-contrast"'));
    expect(html).toContain("2 places, about 10 minutes. You can do this yourself.");
    expect(html).toContain("built with Wix");
    expect(html).not.toMatch(/compliant|legally safe/i);
  });
});
