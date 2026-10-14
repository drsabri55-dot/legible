import { getScan } from "@/lib/data";
import { askQuestion, chatState } from "@/lib/chat/ask";
import { json, sameOrigin } from "@/lib/http";

// GET → the conversation and how many questions are left; POST → one question.
// The report's token (`?report=` or `report` in the body) opens the paid chat.
export const maxDuration = 30;

const STATUS = { not_found: 404, off: 409, empty: 400, too_long: 400, used: 409, paused: 429, failed: 502 } as const;

export async function GET(req: Request, ctx: RouteContext<"/api/scans/[id]/chat">) {
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return json({ error: "Not found" }, 404);
  const s = await chatState(scan, new URL(req.url).searchParams.get("report") ?? undefined);
  return json({ ...s, messages: s.messages.map((m) => ({ id: m.id, role: m.role, body: m.body })) }, 200, { "cache-control": "no-store" });
}

export async function POST(req: Request, ctx: RouteContext<"/api/scans/[id]/chat">) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { question?: unknown; report?: unknown } | null;
  if (!body || typeof body.question !== "string") return json({ code: "empty" }, 400);
  const report = typeof body.report === "string" ? body.report : undefined;
  const r = await askQuestion(id, body.question, undefined, report);
  if (!r.ok) return json({ code: r.code }, STATUS[r.code]);
  const scan = await getScan(id);
  const left = scan ? (await chatState(scan, report)).left : 0;
  return json({ answer: r.answer, left });
}
