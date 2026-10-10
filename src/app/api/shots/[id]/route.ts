import { getShot } from "@/lib/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A screenshot from a scan. Ids are random and appear only on the private
// result and report pages, like the scan and report links themselves.
export async function GET(_req: Request, ctx: RouteContext<"/api/shots/[id]">) {
  const { id } = await ctx.params;
  const image = UUID.test(id) ? await getShot(id.toLowerCase()) : null;
  if (!image) return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  return new Response(new Uint8Array(image), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=86400",
      "x-robots-tag": "noindex",
    },
  });
}
