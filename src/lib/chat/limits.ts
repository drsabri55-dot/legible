import "server-only";
import { env } from "../env";
import { paidAgentOn } from "../spend";

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
