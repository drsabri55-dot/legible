// Every fixed line of the chat, as approved in the owner's design doc.
export type ChatPlace = "scan" | "result" | "report" | "agent";

export const CHAT = {
  label: "Your question",
  ask: "Ask",
  you: "You",
  legible: "Legible",
  writing: "Writing an answer…",
  tryAgain: "Try again",
  suggested: "Suggested questions",
  paused: "Questions are paused until tomorrow, because our agent has reached its limit for today. Your result and every fix are still here.",
  usedFree: "You have used your 5 questions. The full report tests your whole site, up to 50 pages, and comes with 100 questions.",
  usedPaid: "You have used the 100 questions that come with this report.",
} as const;

export function chatIntro(place: ChatPlace, limit: number): { heading: string; intro: string } {
  switch (place) {
    case "scan":
    case "agent":
      return { heading: "Ask about this scan", intro: `Ask our agent about what it has found so far, or what a problem means. You can ask ${limit} questions with this free scan.` };
    case "result":
      return { heading: "Ask about your result", intro: "Ask about any problem on this page, how to fix it, or what to do first. Answers come from this scan's results." };
    case "report":
      return { heading: "Ask about your report", intro: "Ask about any page we tested, any problem, or the order to fix them in." };
  }
}

export const leftText = (left: number, limit: number) => `${left} of ${limit} questions left`;

export const privacyText = (on: "scan" | "report") =>
  on === "scan"
    ? "Questions and answers are saved with this scan. Anyone with this page's link can read them."
    : "Questions and answers are saved with this report. Anyone with this report's link can read them.";

export function suggestions(place: ChatPlace): string[] {
  return place === "scan" || place === "agent"
    ? ["What have you found so far?", "Why test with a keyboard?", "What does WCAG mean?"]
    : ["What should I fix first?", "Which problems can I fix myself?", "What does my score mean?"];
}

export function errorText(code: string): string {
  if (code === "too_long") return "Please keep your question under 500 characters.";
  if (code === "paused") return CHAT.paused;
  return "That answer did not come through. It has not used one of your questions. Please try again.";
}
