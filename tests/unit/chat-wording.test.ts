// The chat's fixed lines, as approved in the design doc.
import { describe, expect, it } from "vitest";
import { CHAT, chatIntro, errorText, leftText, privacyText, suggestions } from "@/components/chat/wording";

describe("chat wording", () => {
  it("has a heading and intro for each place", () => {
    expect(chatIntro("scan", 5)).toEqual({ heading: "Ask about this scan", intro: "Ask our agent about what it has found so far, or what a problem means. You can ask 5 questions with this free scan." });
    expect(chatIntro("result", 5).heading).toBe("Ask about your result");
    expect(chatIntro("report", 100)).toEqual({ heading: "Ask about your report", intro: "Ask about any page we tested, any problem, or the order to fix them in." });
  });
  it("counts what is left", () => {
    expect(leftText(4, 5)).toBe("4 of 5 questions left");
    expect(leftText(1, 100)).toBe("1 of 100 questions left");
  });
  it("says who can read the conversation", () => {
    expect(privacyText("scan")).toBe("Questions and answers are saved with this scan. Anyone with this page's link can read them.");
    expect(privacyText("report")).toBe("Questions and answers are saved with this report. Anyone with this report's link can read them.");
  });
  it("suggests three questions", () => {
    expect(suggestions("scan")).toEqual(["What have you found so far?", "Why test with a keyboard?", "What does WCAG mean?"]);
    expect(suggestions("result")).toEqual(["What should I fix first?", "Which problems can I fix myself?", "What does my score mean?"]);
  });
  it("explains every refusal", () => {
    expect(errorText("failed")).toBe("That answer did not come through. It has not used one of your questions. Please try again.");
    expect(errorText("too_long")).toBe("Please keep your question under 500 characters.");
    expect(CHAT.paused).toBe("Questions are paused until tomorrow, because our agent has reached its limit for today. Your result and every fix are still here.");
    expect(CHAT.usedFree).toBe("You have used your 5 questions. The full report tests your whole site, up to 50 pages, and comes with 100 questions.");
    expect(CHAT.usedPaid).toBe("You have used the 100 questions that come with this report.");
  });
});
