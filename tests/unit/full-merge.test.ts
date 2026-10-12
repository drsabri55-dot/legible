import { describe, expect, it } from "vitest";
import { AI_FIXES_PER_REPORT, FULL_REPORT_PAGES, aiFixesUsed, mergeFullPages } from "@/lib/report/full";
import { buildReport } from "@/lib/report/model";
import { page, rule, sampleScan } from "./fixture";

describe("one report from the free scan and the whole-site pages", () => {
  it("adds new pages after the free scan's and before its skipped ones, without repeats", () => {
    const raw = sampleScan();
    const extra = [
      page("https://www.shop.example/team", [rule("image-alt", "critical", ['<img src="t.jpg">'])], []),
      page("https://WWW.shop.example/about/", [], []), // the about page again, by another spelling
      page("https://www.shop.example/team#top", [], []),
    ];
    const merged = mergeFullPages(raw, extra);
    expect(merged.pages.map((p) => p.url)).toEqual([
      "https://www.shop.example/",
      "https://www.shop.example/about",
      "https://www.shop.example/team",
      "https://www.shop.example/private",
    ]);
    expect(raw.pages).toHaveLength(3); // unchanged
    expect(buildReport(merged).pagesScanned).toBe(3);
  });

  it("counts the AI fixes already used", () => {
    const p = page("https://x.example/", [rule("image-alt", "critical", ["<img>", "<img>"])], []);
    p.violations[0].nodes[0].fix = { code: "x", kind: "css", status: "tested", source: "ai" };
    p.violations[0].nodes[1].fix = { code: "y", kind: "html", status: "tested", source: "rule" };
    expect(aiFixesUsed([p])).toBe(1);
    expect(FULL_REPORT_PAGES).toBe(50);
    expect(AI_FIXES_PER_REPORT).toBe(300);
  });
});
