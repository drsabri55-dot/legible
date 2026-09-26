import { after } from "next/server";
import { getScan, setLeadEmail } from "@/lib/data";
import { sendEmail } from "@/lib/email/send";
import { countOf, freeResultNextStep } from "@/lib/email/wording";
import { env } from "@/lib/env";
import { json, sameOrigin } from "@/lib/http";
import { formatUsd, reportPriceCents } from "@/lib/pricing";
import { siteName } from "@/lib/url";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/scans/:id/email { email } → emails the free result and keeps the
// address as a lead. One email per scan.
export async function POST(req: Request, ctx: RouteContext<"/api/scans/[id]/email">) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const { id } = await ctx.params;
  const scan = await getScan(id);
  if (!scan || scan.status !== "complete" || !scan.summary) return json({ error: "Not found" }, 404);
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return json({ error: "Enter an email address, like you@yourbusiness.com." }, 400);
  if (scan.lead_email) return json({ ok: true });

  await setLeadEmail(scan.id, email);
  const summary = scan.summary;
  after(async () => {
    try {
      await sendEmail({
        to: email,
        template: "free-result",
        vars: {
          site: siteName(scan.host),
          score: summary.score ?? "–",
          failures: countOf(summary.totalIssues, "failure"),
          pages: countOf(summary.pagesScanned, "page"),
          result_link: `${env.appUrl()}/scan/${scan.id}`,
          next_step: freeResultNextStep(summary.totalIssues, formatUsd(reportPriceCents())),
          app_url: env.appUrl().replace(/^https?:\/\//, ""),
        },
      });
    } catch (e) {
      console.error("[lead email]", e);
    }
  });
  return json({ ok: true });
}
