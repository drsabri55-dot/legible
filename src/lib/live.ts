import "server-only";

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
