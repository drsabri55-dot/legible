import { describe, expect, it } from "vitest";
import { buildReport, displaySelector, freeSummary, scoreFrom } from "@/lib/report/model";
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

describe("elements repeated across pages", () => {
  const header = '<button class="menu"><svg></svg></button>';
  const repeated = rawScan(
    ["https://shop.example/", "https://shop.example/a", "https://shop.example/b"].map((url) =>
      page(url, [{ ...rule("button-name", "critical", [header]), nodes: [{ html: header, target: [".menu"], impact: "critical" }] }], [
        "html-has-lang",
      ]),
    ),
  );
  const r = buildReport(repeated);

  it("counts a shared header button once, not once per page", () => {
    expect(r.issues[0].instances).toBe(1);
    expect(r.totalIssues).toBe(1);
    expect(r.counts.critical).toBe(1);
    expect(r.issues[0].pages).toHaveLength(3);
  });

  it("shows it as one example that also appears on the other pages", () => {
    expect(r.issues[0].examples).toHaveLength(1);
    expect(r.issues[0].examples[0]).toMatchObject({ pageUrl: "https://shop.example/", alsoOn: 2 });
  });

  it("keeps each page's own count in the page list", () => {
    expect(r.pages.map((p) => p.issues)).toEqual([1, 1, 1]);
  });
});

describe("site name", () => {
  it("uses the address the customer entered and notes a redirect", () => {
    const raw = { ...sampleScan(), startUrl: "https://www.bbc.co.uk/", finalUrl: "https://www.bbc.com/" };
    expect(buildReport(raw)).toMatchObject({ site: "bbc.co.uk", redirectedTo: "bbc.com" });
    expect(buildReport(sampleScan()).redirectedTo).toBeNull();
  });

  it("marks steps into frames in selectors", () => {
    const raw = rawScan([page("https://x.example/", [{ ...rule("image-alt", "critical", ["<img>"]), nodes: [{ html: "<img>", target: ["iframe#map", "img.pin"], impact: "critical" }] }], [])]);
    expect(buildReport(raw).issues[0].examples[0].selector).toBe("iframe#map → img.pin");
  });
});

describe("displaySelector", () => {
  it("keeps short selectors and trims generated ones to their last step", () => {
    expect(displaySelector(["#main .price"])).toBe("#main .price");
    const long = ".a1b2c3.Card-styles__CardStyled-sc-123:nth-child(4) > div[data-testid=\"inner\"] > .Image-styles__ImageStyled-sc-9 > img.hero";
    expect(displaySelector([long])).toBe("… > img.hero");
    expect(displaySelector(["iframe#map", long])).toBe("iframe#map → … > img.hero");
  });
});
