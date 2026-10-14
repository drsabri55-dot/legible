import { getLiveFrameStamp, getScan, listLiveEvents } from "@/lib/data";
import { json } from "@/lib/http";
import { liveState } from "@/lib/live";

// GET /api/scans/:id/live → the scan's progress and, while the agent runs,
// what it is doing. Polled every 2 seconds by the scanning page.
export async function GET(_req: Request, ctx: RouteContext<"/api/scans/[id]/live">) {
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return json({ error: "Not found" }, 404);
  const running = scan.status === "queued" || scan.status === "running";
  const [events, frame] = running && scan.agent === "on" ? await Promise.all([listLiveEvents(id), getLiveFrameStamp(id)]) : [[], null];
  return json(liveState(scan, events, frame?.updatedAt ?? null), 200, { "cache-control": "no-store" });
}
