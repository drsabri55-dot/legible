import { describe, expect, it } from "vitest";
import { fill, htmlToText, renderEmail, TEMPLATES } from "@/lib/email/render";
import { countOf, freeResultNextStep, reportStartWith } from "@/lib/email/wording";

const VARS = {
  link: "https://legible.example/auth/verify?token=abc",
  email: "owner@example.com",
  site: "shop.example",
  score: 68,
  failures: "143 failures",
  pages: "6 pages",
  next_step: "The full report lists every failure. It costs $99, once.",
  start_with: "Must-fix issues: 4. Start with those.",
  ending: "That is every page we could reach, up to 50.",
  result_link: "https://legible.example/scan/1",
  report_link: "https://legible.example/report/abc",
  account_link: "https://legible.example/account",
  price: "$99",
  amount: "$99",
  app_url: "legible.example",
  price_monthly: "$39",
  monitor_link: "https://legible.example/monitoring?r=abc",
  unsubscribe_link: "https://legible.example/unsubscribe?e=x&s=y",
  company_address: "Legible, 1 Example Street",
  previous_score: 61,
  fixed: 12,
  new: 2,
  subject: "Alert",
  message: "Something happened",
};

describe("email templates", () => {
  it.each(TEMPLATES)("%s renders with a subject, HTML and plain text", async (name) => {
    const email = await renderEmail(name, VARS);
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.subject).not.toContain("{{");
    expect(email.html).not.toContain("{{");
    expect(email.text.length).toBeGreaterThan(20);
  });

  it("carries the disclaimer in every customer email", async () => {
    for (const name of ["free-result", "report-ready", "monitoring-offer", "monitoring-result"] as const) {
      const { html } = await renderEmail(name, VARS);
      expect(html).toContain("identifies issues measured against WCAG 2.1 Level AA");
    }
  });

  it("has an unsubscribe link in marketing emails", async () => {
    expect((await renderEmail("monitoring-offer", VARS)).html).toContain(VARS.unsubscribe_link.replace(/&/g, "&amp;"));
  });

  it("escapes values and refuses missing ones", () => {
    expect(fill("<b>{{site}}</b>", { site: '<script>"x"' }, true)).toBe("<b>&lt;script&gt;&quot;x&quot;</b>");
    expect(() => fill("{{nope}}", {}, true)).toThrow(/nope/);
  });

  it("turns links into readable text", () => {
    expect(htmlToText('<p>Open <a href="https://a.example/x">your report</a></p>')).toBe(
      "Open your report (https://a.example/x)",
    );
  });
});

describe("email wording", () => {
  it("counts in words that agree with the number", () => {
    expect(countOf(1, "failure")).toBe("1 failure");
    expect(countOf(0, "failure")).toBe("0 failures");
    expect(countOf(6, "page")).toBe("6 pages");
  });

  it("offers the report only when there is something in it", () => {
    expect(freeResultNextStep(0, "$99")).not.toContain("$99");
    expect(freeResultNextStep(0, "$99")).toContain("no report to buy");
    expect(freeResultNextStep(3, "$99")).toContain("It costs $99, once.");
  });

  it("never says to start with zero must-fix issues", () => {
    expect(reportStartWith(0)).toBe("None are in the must-fix group, so start with the should-fix issues.");
    expect(reportStartWith(4)).toBe("Must-fix issues: 4. Start with those.");
  });
});
