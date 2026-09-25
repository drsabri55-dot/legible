import { describe, expect, it } from "vitest";
import { buildReport, freeSummary, scoreFrom } from "@/lib/report/model";
import { page, rawScan, rule, sampleScan } from "./fixture";

describe("scoreFrom", () => {
  it("is the weighted share of rules passed", () => {
    const passed = new Map([["a", "critical" as const]]);
    const failed = new Map([["b", "critical" as const]]);
    expect(scoreFrom(passed, failed)).toBe(50);
    expect(scoreFrom(new Map([["a", "serious" as const]]), new Map())).toBe(100);
    expect(scoreFrom(new Map(), new Map())).toBeNull();
  });
});

describe("buildReport", () => {
  const r = buildReport(sampleScan());

  it("names the site without www", () => {
    expect(r.site).toBe("shop.example");
  });

  it("counts failing elements by impact across pages", () => {
    expect(r.counts).toEqual({ critical: 4, serious: 2, moderate: 1, minor: 0 });
    expect(r.totalIssues).toBe(7);
    expect(r.pagesScanned).toBe(2);
  });

  it("scores rules, not elements, and a rule failing anywhere counts as failed", () => {
    // failed: image-alt 10, color-contrast 7, form-field-multiple-labels 3 = 20
    // passed: html-has-lang 7, document-title 7, label 10, button-name 10, link-name 7 = 41
    expect(r.rulesFailed).toBe(3);
    expect(r.rulesPassed).toBe(5);
    expect(r.score).toBe(Math.round((100 * 41) / 61));
  });

  it("groups worst first into must, should and nice", () => {
    expect(r.groups.map((g) => [g.key, g.issues.map((i) => i.ruleId)])).toEqual([
      ["must", ["image-alt"]],
      ["should", ["color-contrast"]],
      ["nice", ["form-field-multiple-labels"]],
    ]);
    const img = r.issues[0];
    expect(img.instances).toBe(4);
    expect(img.pages).toHaveLength(2);
    expect(img.title).toBe("Images have no text alternative");
    expect(img.criteria).toEqual([{ sc: "1.1.1", name: "Non-text Content", level: "A" }]);
    expect(img.examples[0].fixed).toBe('<img src="a.jpg" alt="[Describe the image]">');
  });

  it("lists checks that need a person, but not ones that also failed", () => {
    expect(r.needsReview).toEqual([]);
    const withReview = buildReport(
      rawScan([page("https://x.example/", [], ["html-has-lang"], { incomplete: [rule("video-caption", "critical", ["<video>"])] })]),
    );
    expect(withReview.needsReview).toEqual([{ ruleId: "video-caption", title: "Videos have no captions", instances: 1 }]);
  });

  it("keeps skipped pages in the page list with their reason", () => {
    expect(r.pages.find((p) => p.url.endsWith("/private"))).toMatchObject({ status: "skipped", reason: "robots" });
  });

  it("falls back to axe's own text for rules outside the catalogue", () => {
    const x = buildReport(rawScan([page("https://x.example/", [rule("brand-new-rule", "serious", ["<div>"])], [])]));
    expect(x.issues[0]).toMatchObject({ title: "brand-new-rule help", group: "should" });
  });
});

describe("freeSummary", () => {
  it("shows two issues with one example each and hides the rest", () => {
    const s = freeSummary(buildReport(sampleScan()));
    expect(s.samples.map((i) => i.ruleId)).toEqual(["image-alt", "color-contrast"]);
    expect(s.samples[0].examples).toHaveLength(1);
    expect(s.issueTypes).toBe(3);
    expect(s.groupCounts).toEqual({ must: 1, should: 1, nice: 1 });
  });
});
