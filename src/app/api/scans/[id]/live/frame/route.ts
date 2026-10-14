import { getLiveFrame } from "@/lib/data";

// GET /api/scans/:id/live/frame → the agent's latest picture while the scan runs.

export async function GET(_req: Request, ctx: RouteContext<"/api/scans/[id]/live/frame">) {
  const { id } = await ctx.params;
  const frame = await getLiveFrame(id);
  if (!frame) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(frame.jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
}
