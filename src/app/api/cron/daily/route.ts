import { signFor, safeEqual } from "@/lib/crypto";
import { claimOffer, deleteExpiredLoginTokens, failStaleScans, releaseOffer, reportsDueForOffer, staleFullJobs } from "@/lib/data";
import { QUIET_MINUTES, resumeStaleFullTest, retryUnsentFullEmails } from "@/lib/full";
import { sendEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { bearer, json } from "@/lib/http";
import { MONITORING_PRICE } from "@/lib/pricing";
import { siteName } from "@/lib/url";

export const maxDuration = 60;

// Runs once a day (vercel.json). Sends the day-3 monitoring offer, marks scans
// that never finished as failed, resumes quiet whole-site tests and clears old
// sign-in links.
export async function GET(req: Request) {
  if (!safeEqual(bearer(req), env.cronSecret())) return json({ error: "Unauthorised" }, 401);

  // Agent scans can wait in the worker's queue and take up to 25 minutes.
  const stale = await failStaleScans(90);
  await deleteExpiredLoginTokens();
  // Whole-site tests that went quiet (the worker restarted) are picked up again.
  let resumed = 0;
  for (const report of await staleFullJobs(QUIET_MINUTES)) {
    await resumeStaleFullTest(report).catch((e) => console.error("[cron] resume failed", report.id, e));
    resumed++;
  }
  // A whole-site email whose send failed is tried again.
  await retryUnsentFullEmails(10).catch((e) => console.error("[cron] full report emails", e));

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
          site: siteName(r.host),
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
  return json({ ok: true, staleScans: stale, resumedTests: resumed, offersSent: sent, offersFailed: failed });
}
