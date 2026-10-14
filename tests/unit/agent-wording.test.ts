// The AI agent page's fixed lines, as approved in the design doc.
import { describe, expect, it } from "vitest";
import { AGENT } from "@/components/agent/wording";

describe("AI agent page wording", () => {
  it("uses the approved lines", () => {
    expect(AGENT).toEqual({
      landingLead: "Have a question first?",
      landingButton: "Ask our AI agent about your site",
      kicker: "AI agent",
      heading: "Ask our agent about your site",
      intro: "Type your website address and start asking. While you talk, our agent tests your home page and five more by keyboard, so its answers come from real tests. You can ask 5 questions free.",
      start: "Start the chat",
      watch: "Watch the test",
      resultReady: "Your result is ready.",
      seeResult: "See your result",
    });
  });
});
