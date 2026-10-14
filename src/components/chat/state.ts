// Shared by the chat and the scanning page. When a scan finishes, the page
// re-renders on the server, which would throw away a question in flight or a
// half-typed one, so the page waits while any chat is busy.
const busy = new Set<string>();

export function markChatBusy(key: string, on: boolean): void {
  if (on) busy.add(key);
  else busy.delete(key);
}

export function chatBusy(): boolean {
  return busy.size > 0;
}

// A question saved without its answer yet: the answer is still being written,
// or arrived while the page was re-rendering.
export function waitingForAnswer(messages: { role: "user" | "assistant" }[]): boolean {
  return messages.at(-1)?.role === "user";
}
