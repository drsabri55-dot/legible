import { getReportByToken } from "@/lib/data";
import { pdfFilename } from "@/lib/fulfil";
import { renderPdf } from "@/lib/worker";

export const maxDuration = 60;

// GET /report/:token/pdf. PDFs are made on demand from the stored scan, so
// a report can always be regenerated and nothing needs file storage.
export async function GET(_req: Request, ctx: RouteContext<"/report/[token]/pdf">) {
  const { token } = await ctx.params;
  const report = await getReportByToken(token);
  if (!report) return new Response("Not found", { status: 404 });
  try {
    const pdf = await renderPdf(`/report/${token}?print=1`);
    const name = pdfFilename(report.host, new Date(report.raw.finishedAt));
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "private, max-age=3600",
        "x-robots-tag": "noindex",
      },
    });
  } catch (e) {
    console.error("[pdf]", e);
    return new Response("The PDF could not be made right now. Try again in a minute, or print this page from your browser.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
