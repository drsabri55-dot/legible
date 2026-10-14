// What the testing agent is doing, for the live view: one short note per
// step, written here from the action (never by the model), and the latest
// picture at most every few seconds. Sending must never slow the scan, so
// events queue behind one another and are dropped when the site is slow.
import type { FocusInfo } from "./dom";

export type LiveKind = "page" | "step" | "done";

export interface LiveEvent {
  step: number;
  page: string;
  title: string | null;
  kind: LiveKind;
  note: string;
  frame?: Buffer;
}

export const FRAME_EVERY_MS = 3000;
const MAX_QUEUED = 5;

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function focusText(f: FocusInfo): string {
  if (!f) return "Nothing has focus.";
  const name = short(f.name.replace(/\s+/g, " ").trim());
  return name ? `Focus moved to “${name}”.` : `Focus moved to an unnamed ${f.role || f.tag}.`;
}

export const MEASURE_NOTES = {
  walk: "Pressed Tab through the whole page.",
  reflow: "Checked the page 320 pixels wide.",
  spacing: "Checked the text with wider spacing.",
} as const;

export function stepNote(action: string, input: Record<string, unknown>, focus: FocusInfo): string {
  switch (action) {
    case "press":
      return `Pressed ${String(input.key)}. ${focusText(focus)}`;
    case "type":
      return focus?.name ? `Typed “${String(input.text)}” into “${short(focus.name)}”.` : `Typed “${String(input.text)}”.`;
    case "zoom":
      return input.on ? "Viewed the page 320 pixels wide." : "Viewed the page at full width again.";
    case "spacing":
      return input.on ? "Turned on wider text spacing." : "Turned wider text spacing off.";
    case "look":
      return "Looked at the page again.";
    case "claim":
      return "Measured a possible problem.";
    case "judge":
      return "Noted something for a second check.";
    default:
      return "Tested the page.";
  }
}

export function liveSender(
  send: (message: unknown) => Promise<unknown>,
  opts: { frameEveryMs?: number; maxQueued?: number; now?: () => number } = {},
) {
  const every = opts.frameEveryMs ?? FRAME_EVERY_MS;
  const max = opts.maxQueued ?? MAX_QUEUED;
  const now = opts.now ?? Date.now;
  let lastFrame = -Infinity;
  let queued = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    push(e: LiveEvent): void {
      if (queued >= max) return; // the site is slow: this step is not shown
      let frame: string | undefined;
      if (e.frame && now() - lastFrame >= every) {
        frame = e.frame.toString("base64");
        lastFrame = now();
      }
      const message = { type: "live", step: e.step, page: e.page, title: e.title, kind: e.kind, note: e.note, ...(frame ? { frame } : {}) };
      queued++;
      chain = chain.then(() => send(message).then(() => undefined, () => undefined)).finally(() => void queued--);
    },
    idle: () => chain,
  };
}
