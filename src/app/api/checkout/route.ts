import { getReportByScanId, getScan } from "@/lib/data";
import { env } from "@/lib/env";
import { json, sameOrigin } from "@/lib/http";
import { reportPriceCents } from "@/lib/pricing";
import { reportForSale } from "@/lib/report/model";
import { PRODUCT_NAME, stripe } from "@/lib/stripe";
import { siteName } from "@/lib/url";

// POST /api/checkout { scanId } → { url } of the Stripe Checkout page.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  const body = (await req.json().catch(() => null)) as { scanId?: unknown } | null;
  const scanId = typeof body?.scanId === "string" ? body.scanId : "";
  const scan = await getScan(scanId);
  if (!scan || scan.status !== "complete") return json({ error: "This scan is not ready yet." }, 404);
  if (!reportForSale(scan.summary)) {
    return json({ error: "No failures were found, so there is no report to buy." }, 409);
  }
  if (await getReportByScanId(scan.id)) {
    return json({ error: "The report for this scan has already been bought. Sign in to your account to open it." }, 409);
  }

  const base = env.appUrl();
  if (env.fakePayments()) {
    return json({ url: `${base}/checkout/dev?scan=${scan.id}` });
  }
  if (!env.stripeSecretKey()) return json({ error: "Payments are not set up yet." }, 503);

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: reportPriceCents(),
          product_data: {
            name: PRODUCT_NAME,
            description: `Accessibility report for ${siteName(scan.host)}, measured against WCAG 2.1 Level AA.`,
          },
        },
      },
    ],
    customer_email: scan.lead_email ?? undefined,
    customer_creation: "if_required",
    metadata: { scan_id: scan.id, host: scan.host },
    payment_intent_data: { metadata: { scan_id: scan.id, host: scan.host } },
    success_url: `${base}/scan/${scan.id}/paid?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/scan/${scan.id}`,
    allow_promotion_codes: true,
  });
  if (!session.url) return json({ error: "Stripe did not return a checkout page." }, 502);
  return json({ url: session.url });
}
