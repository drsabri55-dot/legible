import { getScan } from "@/lib/data";
import { json } from "@/lib/http";
import { failureMessage } from "@/lib/scans";

// GET /api/scans/:id → progress while running; the result page re-renders
// on the server once the status is complete.
export async function GET(_req: Request, ctx: RouteContext<"/api/scans/[id]">) {
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan) return json({ error: "Not found" }, 404);
  return json({
    status: scan.status,
    pagesDone: scan.pages_done,
    pagesTotal: scan.pages_total,
    error: scan.status === "failed" ? failureMessage(scan.error) : null,
  });
}
