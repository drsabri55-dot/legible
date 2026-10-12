import "server-only";
import type { AgentUsage } from "@/types/scan";
import { type AgentMode, type SpendKind, averageFreeScanCostUsd, freeAgentScansInFlight, freeSpendTodayUsd, recordScanSpend } from "./data";
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

function capFrom(value: string, fallback: number): number {
  const n = toNumber(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function dailyCapUsd(): number {
  return capFrom(env.agentDailyCapUsd(), 10);
}

// What one paid report's whole-site test may spend on the agent.
export function reportCapUsd(): number {
  return capFrom(env.agentReportCapUsd(), 15);
}

// Paid work is outside the daily cap: the agent runs whenever it can.
export function paidAgentOn(): boolean {
  return !!env.anthropicApiKey() && !!agentPrices();
}

// Free scans and free chat share the cap. Scans still running are charged only
// when they finish, so they count at the recent average cost; before any cost
// is known, at most two run at once (the worker's own limit). At or over the
// cap, the agent is left out.
export function decideFreeAgent(input: {
  spent: number;
  cap: number;
  inFlight: number;
  averageScanCost: number | null;
}): AgentMode {
  if (input.averageScanCost === null) {
    return input.spent >= input.cap || input.inFlight >= 2 ? "capped" : "on";
  }
  return input.spent + input.inFlight * input.averageScanCost >= input.cap ? "capped" : "on";
}

export async function freeAgentMode(): Promise<AgentMode> {
  if (!env.anthropicApiKey() || !agentPrices()) return "off";
  const [spent, inFlight, averageScanCost] = await Promise.all([
    freeSpendTodayUsd(),
    freeAgentScansInFlight(),
    averageFreeScanCostUsd(),
  ]);
  return decideFreeAgent({ spent, cap: dailyCapUsd(), inFlight, averageScanCost });
}

// Records what the worker says the agent used, priced now. Each charge is
// kept once (scan, kind and ref), so a repeated message never charges twice.
export async function chargeAgent(
  scanId: string,
  kind: SpendKind,
  agent: { model?: unknown; usage?: Partial<AgentUsage> } | undefined,
  ref = "",
): Promise<void> {
  if (!agent?.usage) return;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
  const usage: AgentUsage = {
    inputTokens: n(agent.usage.inputTokens),
    outputTokens: n(agent.usage.outputTokens),
    cacheReadTokens: n(agent.usage.cacheReadTokens),
    cacheWriteTokens: n(agent.usage.cacheWriteTokens),
  };
  const prices = agentPrices();
  await recordScanSpend({
    scanId,
    kind,
    ref: ref.slice(0, 2000),
    model: String(agent.model || "unknown").slice(0, 80),
    usage,
    costUsd: prices ? costUsd(usage, prices) : null,
  });
}
