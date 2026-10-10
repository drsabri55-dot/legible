import type { AgentMode } from "@/lib/data";

// Free scans leave the testing agent out once the day's spending cap is reached.
export function AgentCapNote({ mode }: { mode: AgentMode }) {
  if (mode !== "capped") return null;
  return (
    <p className="mt-4 mb-0 max-w-[46ch] text-[14px] leading-[1.8] text-nc-neutral-400">
      Our testing agent has reached its limit for today, so this result has the automatic checks only. Scan again
      tomorrow to include its keyboard and layout tests.
    </p>
  );
}

// The end of the progress page's "how it works" sentence.
export function scanTimeText(agent: boolean): string {
  return agent
    ? "then tests it by keyboard like a person would. Most scans take 3 to 6 minutes."
    : "then moves to the next page after a short pause. Most scans take under two minutes.";
}

// When the progress page says a scan is taking longer than usual.
export function slowAfterMs(agent: boolean): number {
  return agent ? 7 * 60_000 : 90_000;
}
