import "server-only";
import type { AgentUsage } from "@/types/scan";
import { type AgentMode, freeSpendTodayUsd } from "./data";
import { env } from "./env";

// What the testing agent costs, and whether a free scan may use it today.
// Prices come only from settings: a wrong built-in guess could under-count.

export interface AgentPrices {
  inputPerMtok: number;
  outputPerMtok: number;
}

const toNumber = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function agentPrices(): AgentPrices | null {
  const input = toNumber(env.agentPriceInputPerMtok());
  const output = toNumber(env.agentPriceOutputPerMtok());
  const valid = (n: number) => Number.isFinite(n) && n > 0;
  return valid(input) && valid(output) ? { inputPerMtok: input, outputPerMtok: output } : null;
}

// Cache reads cost a tenth of input; 5-minute cache writes cost a quarter more.
export function costUsd(u: AgentUsage, p: AgentPrices): number {
  const input = u.inputTokens + u.cacheReadTokens * 0.1 + u.cacheWriteTokens * 1.25;
  return (input * p.inputPerMtok + u.outputTokens * p.outputPerMtok) / 1_000_000;
}

export function dailyCapUsd(): number {
  const n = toNumber(env.agentDailyCapUsd());
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

// Free scans and free chat share the cap. At or over it, the agent is left out.
export async function freeAgentMode(): Promise<AgentMode> {
  if (!agentPrices()) return "off";
  return (await freeSpendTodayUsd()) >= dailyCapUsd() ? "capped" : "on";
}
