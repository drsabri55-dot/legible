import "server-only";
import { env } from "../env";
import type { ScanRow } from "../data";
import { freeAgentMode, paidAgentOn } from "../spend";

export const QUESTION_MAX = 500;
export const ANSWER_MAX_TOKENS = 400;

const limitFrom = (v: string, fallback: number) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : fallback;
};

// The chat needs what the agent needs: the key and both prices.
export function chatEnabled(): boolean {
  return paidAgentOn();
}

// Questions per scan in all: 5 free, 100 once the report is bought.
export function chatLimit(paid: boolean): number {
  return paid ? limitFrom(env.chatPaidLimit(), 100) : limitFrom(env.chatFreeLimit(), 5);
}

// The AI agent page promises a chat while the agent tests the site, so it is
// open only when a free scan would run with the agent right now.
export async function agentPageOpen(): Promise<boolean> {
  return chatEnabled() && (await freeAgentMode()) === "on";
}

// A scan's agent chat page: only for a scan that ran with the agent.
export function agentChatOpen(scan: Pick<ScanRow, "status" | "agent">): boolean {
  return chatEnabled() && scan.status !== "failed" && scan.agent === "on";
}
