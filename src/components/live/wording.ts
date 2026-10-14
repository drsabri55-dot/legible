import type { LivePage, LiveState } from "@/lib/live";

// Every fixed line of the live view, as approved in the owner's design doc.
export const LIVE = {
  heading: "Live view",
  intro: "What our testing agent sees as it uses your site with a keyboard. The picture changes every few seconds.",
  pause: "Pause live view",
  resume: "Resume live view",
  pages: "Pages",
  steps: "Latest steps",
  showAll: (n: number) => `Show all ${n} steps`,
  noFrame: "The first picture appears when the agent starts on the home page.",
} as const;

export function progressLabel(s: Pick<LiveState, "status" | "pagesDone" | "pagesTotal"> & { title?: string | null }): string {
  if (s.status === "queued") return "Waiting for a free scanner…";
  if (!s.pagesTotal) return "Reading the home page";
  const n = Math.min(s.pagesDone + 1, s.pagesTotal);
  return `Testing page ${n} of ${s.pagesTotal}${s.title ? `: ${s.title}` : ""}`;
}

export function pageStateText(p: LivePage): string {
  return p.state === "done" ? "Done" : p.state === "now" ? "Testing now" : "Waiting";
}

export function frameAlt(title: string | null, step: number, note: string): string {
  return `${title ? `The ${title} page` : "The page"}, as the agent sees it. Step ${step}: ${note}`;
}
