import { clientIp, json, sameOrigin } from "@/lib/http";
import { startScan } from "@/lib/scans";

// POST /api/scans  { url }  → { id }
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  const result = await startScan(url, clientIp(req));
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ id: result.id }, 201);
}
