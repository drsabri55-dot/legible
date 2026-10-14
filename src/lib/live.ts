import "server-only";
import type { LiveEventRow, ScanRow } from "./data";
import { failureMessage } from "./scans";

// The live view: what the worker sends at each agent step, checked before it
// is stored, and the state the scanning page polls.

export const MAX_FRAME_BYTES = 300_000;
const KINDS = ["page", "step", "done"] as const;

export type LiveMessage = {
  type: "live";
  step: number;
  page: string;
  title: string | null;
  kind: (typeof KINDS)[number];
  note: string;
  frame?: string;
};

const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;

export function isLiveMessage(m: unknown): m is LiveMessage {
  const x = m as Record<string, unknown>;
  return (
    !!x &&
    x.type === "live" &&
    Number.isInteger(x.step) && (x.step as number) > 0 &&
    text(x.page, 2000) &&
    (x.title === null || x.title === undefined || (typeof x.title === "string" && x.title.length <= 300)) &&
    KINDS.includes(x.kind as LiveMessage["kind"]) &&
    text(x.note, 300) &&
    (x.frame === undefined || typeof x.frame === "string")
  );
}

// A JPEG starts with FF D8 FF.
export function frameBytes(b64: string): Buffer | null {
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 4 || buf.length > MAX_FRAME_BYTES) return null;
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? buf : null;
}

export type LivePage = { n: number; url: string | null; title: string | null; state: "done" | "now" | "waiting" };
export type LiveState = {
  status: ScanRow["status"];
  pagesDone: number;
  pagesTotal: number | null;
  error: string | null;
  live: {
    pages: LivePage[];
    latest: { step: number; note: string; title: string | null } | null;
    steps: { step: number; title: string | null; note: string }[];
    frame: string | null;
  } | null;
};

export function liveState(scan: ScanRow, events: LiveEventRow[], frameAt: Date | null): LiveState {
  const base = {
    status: scan.status,
    pagesDone: scan.pages_done,
    pagesTotal: scan.pages_total,
    error: scan.status === "failed" ? failureMessage(scan.error) : null,
  };
  if (scan.agent !== "on") return { ...base, live: null };
  const pages: LivePage[] = [];
  for (const ev of events) {
    let p = pages.find((x) => x.url === ev.page);
    if (!p) {
      p = { n: pages.length + 1, url: ev.page, title: ev.title, state: "now" };
      pages.push(p);
    }
    if (ev.kind === "done") p.state = "done";
  }
  for (const p of pages.slice(0, -1)) if (p.state === "now") p.state = "done";
  const total = Math.max(scan.pages_total ?? 0, pages.length);
  for (let n = pages.length + 1; n <= total; n++) pages.push({ n, url: null, title: null, state: "waiting" });
  const last = events.at(-1);
  return {
    ...base,
    live: {
      pages,
      latest: last ? { step: last.step, note: last.note, title: last.title } : null,
      steps: [...events].reverse().map((ev) => ({ step: ev.step, title: ev.title, note: ev.note })),
      frame: frameAt ? `/api/scans/${scan.id}/live/frame?v=${frameAt.getTime()}` : null,
    },
  };
}
