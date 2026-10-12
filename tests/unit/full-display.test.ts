import { describe, expect, it } from "vitest";
import { fullTestNote, welcomeNote } from "@/components/report/FullNote";

describe("what the report says about the whole-site test", () => {
  it("shows progress while it runs, and why it stopped early", () => {
    expect(fullTestNote("running", 14)).toBe("We are testing the rest of your site. 14 of up to 50 pages so far. This page fills in as we go.");
    expect(fullTestNote("limit", 23)).toBe("This report covers 23 pages. Testing stopped there because it reached its testing limit.");
    expect(fullTestNote("stopped", 9)).toBe("This report covers 9 pages. Testing stopped early because of a problem on our side.");
    expect(fullTestNote("done", 50)).toBeNull();
    expect(fullTestNote(null, 6)).toBeNull();
    expect(fullTestNote("running", 1)).toContain("1 of up to 50 pages");
  });

  it("thanks the buyer and says when the PDF comes", () => {
    expect(welcomeNote("a@b.example", true)).toBe(
      "Payment received. We are testing the rest of your site now. We will email a@b.example when the full report is ready, with the PDF. Bookmark this page: the link is yours to share.",
    );
    expect(welcomeNote("a@b.example", false)).toBe(
      "Payment received. A copy of this report, with the PDF, is on its way to a@b.example. Bookmark this page: the link is yours to share.",
    );
  });
});

describe("whole-site wording that depends on the report", () => {
  it("knows the whole site is being tested before the run has even started", async () => {
    const { wholeSiteTesting } = await import("@/components/report/FullNote");
    expect(wholeSiteTesting({ full_status: "running", delivered_at: new Date() })).toBe(true);
    // Stripe: the buyer lands on the report while delivery still runs.
    expect(wholeSiteTesting({ full_status: null, delivered_at: null })).toBe(true);
    // Bought before the whole-site test existed.
    expect(wholeSiteTesting({ full_status: null, delivered_at: new Date() })).toBe(false);
    expect(wholeSiteTesting({ full_status: "done", delivered_at: new Date() })).toBe(false);
  });

  it("describes the pages a whole-site report covers", async () => {
    const { scopeSentence } = await import("@/components/report/FullNote");
    expect(scopeSentence(false, "11 October 2026")).toBe(
      "Legible scanned the home page and up to five pages linked from its navigation on 11 October 2026.",
    );
    expect(scopeSentence(true, "11 October 2026")).toBe(
      "Legible tested the home page and up to 49 more pages it found by following the site's links, starting on 11 October 2026.",
    );
  });
});
