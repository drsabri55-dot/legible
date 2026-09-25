import { signFor, safeEqual } from "@/lib/crypto";
import { claimOffer, deleteExpiredLoginTokens, failStaleScans, releaseOffer, reportsDueForOffer } from "@/lib/data";
import { sendEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { bearer, json } from "@/lib/http";
import { MONITORING_PRICE } from "@/lib/pricing";

export const maxDuration = 60;

// Runs once a day (vercel.json). Sends the day-3 monitoring offer, marks scans
// that never finished as failed, and clears old sign-in links.
export async function GET(req: Request) {
  if (!safeEqual(bearer(req), env.cronSecret())) return json({ error: "Unauthorised" }, 401);

  const stale = await failStaleScans(10);
  await deleteExpiredLoginTokens();

  const base = env.appUrl();
  let sent = 0;
  let failed = 0;
  for (const r of await reportsDueForOffer()) {
    if (!(await claimOffer(r.id))) continue;
    const unsubscribe = `${base}/unsubscribe?e=${encodeURIComponent(r.email)}&s=${signFor("unsubscribe", r.email)}`;
    try {
      await sendEmail({
        to: r.email,
        template: "monitoring-offer",
        vars: {
          site: r.host,
          price_monthly: MONITORING_PRICE,
          monitor_link: `${base}/monitoring?r=${r.token}`,
          unsubscribe_link: unsubscribe,
          company_address: env.companyAddress(),
        },
        unsubscribeUrl: `${base}/api/unsubscribe?e=${encodeURIComponent(r.email)}&s=${signFor("unsubscribe", r.email)}`,
      });
      sent++;
    } catch (e) {
      console.error("[cron] offer failed", r.email, e);
      await releaseOffer(r.id);
      failed++;
    }
  }
  return json({ ok: true, staleScans: stale, offersSent: sent, offersFailed: failed });
}
