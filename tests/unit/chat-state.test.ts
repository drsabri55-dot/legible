// What keeps the chat whole when the scan finishes: the page waits while a
// question is in flight or being typed, and a question that lost its answer
// is picked up again.
import { describe, expect, it } from "vitest";
import { chatBusy, markChatBusy, waitingForAnswer } from "@/components/chat/state";

describe("chat busy flag", () => {
  it("is busy while any chat is sending or has a draft", () => {
    expect(chatBusy()).toBe(false);
    markChatBusy("a", true);
    markChatBusy("b", true);
    markChatBusy("a", false);
    expect(chatBusy()).toBe(true);
    markChatBusy("b", false);
    expect(chatBusy()).toBe(false);
  });
});

describe("waitingForAnswer", () => {
  it("is true when the last message is a question", () => {
    expect(waitingForAnswer([])).toBe(false);
    expect(waitingForAnswer([{ role: "user" }])).toBe(true);
    expect(waitingForAnswer([{ role: "user" }, { role: "assistant" }])).toBe(false);
  });
});
