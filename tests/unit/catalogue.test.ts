import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { CATALOGUE } from "@/lib/rules/catalogue";
import { criteriaFromTags, understandingUrl, WCAG } from "@/lib/rules/wcag";

const RULES = axe.getRules(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);

describe("rule catalogue", () => {
  it("explains every WCAG A/AA rule axe-core can report", () => {
    const missing = RULES.map((r) => r.ruleId).filter((id) => !CATALOGUE[id]);
    expect(missing).toEqual([]);
  });

  it("knows the name of every success criterion those rules cite", () => {
    for (const r of RULES) {
      for (const tag of r.tags) {
        const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
        if (!m) continue;
        const sc = `${m[1]}.${m[2]}.${m[3]}`;
        if (sc === "2.1.3") continue; // Level AAA, outside the report's scope
        expect(WCAG[sc], `${r.ruleId} cites ${sc}`).toBeDefined();
      }
    }
  });

  it("keeps every entry complete and free of banned phrasing", () => {
    for (const [id, info] of Object.entries(CATALOGUE)) {
      for (const field of ["title", "summary", "why", "who", "fix", "before", "after"] as const) {
        expect(info[field], `${id}.${field}`).toBeTruthy();
      }
      const text = `${info.title} ${info.summary} ${info.why} ${info.fix}`.toLowerCase();
      expect(text, id).not.toMatch(/\bcompliant\b|legally safe|guarantee/);
    }
  });

  it("builds W3C Understanding links", () => {
    expect(understandingUrl("1.4.3")).toBe("https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html");
    expect(understandingUrl("4.1.2")).toBe("https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html");
    expect(criteriaFromTags(["wcag2a", "wcag412", "wcag213", "cat.aria"])).toEqual(["4.1.2"]);
  });
});
