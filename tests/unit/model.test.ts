import { describe, expect, it } from "vitest";
import { buildReport, displaySelector, freeSummary, reportForSale, scoreFrom, siteKey } from "@/lib/report/model";
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
    expect(reportForSale(s)).toBe(true);
  });

  it("offers no report when nothing failed, and lists the checks that need a person", () => {
    const clean = freeSummary(
      buildReport(
        rawScan([page("https://x.example/", [], ["html-has-lang"], { incomplete: [rule("video-caption", "critical", ["<video>"])] })]),
      ),
    );
    expect(clean.totalIssues).toBe(0);
    expect(clean.needsReview).toEqual([{ ruleId: "video-caption", title: "Videos have no captions", instances: 1 }]);
    expect(reportForSale(clean)).toBe(false);
    expect(reportForSale(null)).toBe(false);
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

describe("content embedded from other sites", () => {
  // A YouTube player on the home page, a map from the shop's own subdomain,
  // and an image of the shop's own.
  const inFrame = (html: string, frameHost: string) => ({ html, target: ["iframe", ".x"], impact: "critical", frameHost });
  const raw = rawScan([
    page(
      "https://www.shop.example/",
      [
        { ...rule("button-name", "critical", []), nodeCount: 1, nodes: [inFrame('<button class="x"></button>', "www.youtube.com")] },
        { ...rule("aria-allowed-attr", "critical", []), nodeCount: 1, nodes: [{ ...inFrame('<a class="x" aria-level="2">x</a>', "maps.shop.example"), failureSummary: 'ARIA attribute is not allowed: aria-level="2"' }] },
        rule("image-alt", "critical", ['<img src="a.jpg">']),
      ],
      ["html-has-lang"],
    ),
  ]);
  const r = buildReport(raw);
  const issue = (id: string) => r.issues.find((i) => i.ruleId === id)!;

  it("names the other site and offers no corrected code for it", () => {
    const ex = issue("button-name").examples[0];
    expect(ex.embeddedFrom).toBe("youtube.com");
    expect(ex.fixed).toBeNull();
    expect(ex.note).toBe(
      "This is part of content embedded from youtube.com, so its code comes from youtube.com and you cannot change it yourself. Check the embed's settings, report the problem to youtube.com, or link to the content instead of embedding it.",
    );
    expect(issue("button-name").embeddedFrom).toBe("youtube.com");
  });

  it("treats frames from the site's own domain as the owner's code", () => {
    const ex = issue("aria-allowed-attr").examples[0];
    expect(ex.embeddedFrom).toBeNull();
    expect(ex.fixed).toBe('<a class="x">x</a>');
    expect(issue("aria-allowed-attr").embeddedFrom).toBeNull();
  });

  it("still counts embedded failures, because visitors still meet them", () => {
    expect(r.totalIssues).toBe(3);
  });

  it("shows fixable issues first in the free sample", () => {
    expect(freeSummary(r).samples.map((i) => i.ruleId)).not.toContain("button-name");
  });

  it("only calls a whole issue embedded when every element is known to be", () => {
    const partly = rawScan([
      page(
        "https://www.shop.example/",
        [{ ...rule("button-name", "critical", []), nodeCount: 40, nodes: [inFrame('<button class="x"></button>', "www.youtube.com")] }],
        [],
      ),
    ]);
    expect(buildReport(partly).issues[0].embeddedFrom).toBeNull();
  });

  it("compares sites by registrable domain", () => {
    expect(siteKey("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(siteKey("player.vimeo.com")).toBe("vimeo.com");
    expect(siteKey("shop.example")).toBe("shop.example");
    expect(siteKey("127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("the testing agent's results", () => {
  const withAgent = () => {
    const focus = rule("legible-focus-visible", "serious", ['<a href="#">Go</a>'], ["wcag2aa", "wcag247"]);
    focus.nodes[0].shot = "11111111-1111-4111-8111-111111111111";
    const reach = rule("legible-keyboard-reach", "serious", ['<div class="m">Menu</div>'], ["wcag2a", "wcag211"]);
    const p = page("https://www.shop.example/", [focus], ["image-alt", "legible-reflow", "legible-keyboard-trap"], {
      incomplete: [reach],
      agent: {
        status: "partly",
        reason: "time limit",
        steps: 20,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        reviews: [{ kind: "image-description", selector: "#photo", html: '<img id="photo" alt="image123">', reason: "The alt text is a file name.", shot: "22222222-2222-4222-8222-222222222222" }],
      },
    });
    return rawScan([p]);
  };

  it("counts measured failures in the score with their screenshot", () => {
    const r = buildReport(withAgent());
    const issue = r.issues.find((i) => i.ruleId === "legible-focus-visible")!;
    expect(issue.title).toBe("You cannot see where keyboard focus is");
    expect(issue.criteria.map((c) => c.sc)).toEqual(["2.4.7"]);
    expect(issue.examples[0].shot).toBe("11111111-1111-4111-8111-111111111111");
    expect(r.rulesFailed).toBe(1);
    expect(r.rulesPassed).toBe(3); // image-alt, reflow, keyboard trap
  });

  it("lists hand checks and the agent's review outside the score", () => {
    const r = buildReport(withAgent());
    expect(r.needsReview).toEqual([{ ruleId: "legible-keyboard-reach", title: "Something clickable may not be reachable by keyboard", instances: 1 }]);
    expect(r.agentReviews).toEqual([
      {
        pageUrl: "https://www.shop.example/",
        kind: "image-description",
        title: "An image description may not describe the image",
        selector: "#photo",
        html: '<img id="photo" alt="image123">',
        reason: "The alt text is a file name.",
        shot: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    expect(r.totalIssues).toBe(1);
    expect(r.agentUsed).toBe(true);
    expect(r.pages[0].agent).toEqual({ status: "partly", reason: "time limit" });
    expect(freeSummary(r).agentReviewCount).toBe(1);
  });

  it("builds old scans exactly as before", () => {
    const r = buildReport(sampleScan());
    expect(r.agentUsed).toBe(false);
    expect(r.agentReviews).toEqual([]);
    expect(r.pages.every((p) => p.agent === null)).toBe(true);
    expect(r.issues.every((i) => i.examples.every((e) => e.shot === null))).toBe(true);
  });
});
