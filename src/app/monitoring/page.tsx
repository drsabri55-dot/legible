import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { getReportByToken, requestMonitoring } from "@/lib/data";
import { alertOwner } from "@/lib/email/send";
import { env } from "@/lib/env";
import { MONITORING_PRICE } from "@/lib/pricing";
import { siteName } from "@/lib/url";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Monthly monitoring", robots: { index: false, follow: false } };

async function join(form: FormData) {
  "use server";
  const token = String(form.get("r") || "");
  const report = await getReportByToken(token);
  if (!report) notFound();
  const created = await requestMonitoring(report.user_id, report.host);
  if (created) {
    await alertOwner(
      `Monitoring request: ${report.host}`,
      `${report.email} asked for monthly monitoring of ${report.host} (${MONITORING_PRICE}/month). Email them to confirm the start date before any charge.`,
      `${env.appUrl()}/report/${token}`,
    );
  }
  redirect(`/monitoring?r=${token}&joined=1`);
}

// Reached from the day-3 email. In version 1 this records the request and
// tells the owner; billing for monitoring is switched on in a later build.
export default async function MonitoringPage(props: PageProps<"/monitoring">) {
  const sp = await props.searchParams;
  const token = typeof sp.r === "string" ? sp.r : "";
  const report = await getReportByToken(token);
  if (!report) notFound();

  return (
    <SiteShell width="narrow">
      <Kicker>Monthly monitoring</Kicker>
      {sp.joined === "1" ? (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">Thank you. We have your request</h1>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            We will email {report.email} to confirm the start date for {siteName(report.host)}. Nothing is charged until you
            agree to it.
          </p>
          <p className="mt-6 text-[14px]">
            <Link href={`/report/${token}`}>Back to your report</Link>
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-[clamp(28px,4vw,40px)] leading-[1.12] tracking-[-0.02em] break-words">
            Keep {siteName(report.host)} checked every month
          </h1>
          <ul className="mt-6 space-y-3 pl-5 text-[15px] leading-[1.75] text-nc-neutral-300">
            <li>A fresh scan of the same pages every month</li>
            <li>An email showing what was fixed and what is new</li>
            <li>An updated report and PDF each time</li>
          </ul>
          <p className="mt-6 text-[15px] text-nc-neutral-200">
            {MONITORING_PRICE} a month. Cancel at any time.
          </p>
          <form action={join} className="mt-8">
            <input type="hidden" name="r" value={token} />
            <button type="submit" className="btn btn-primary btn-cta">
              Yes, monitor {siteName(report.host)}
            </button>
          </form>
          <p className="mt-4 text-[13px] text-nc-neutral-400">
            We will confirm by email before the first charge.
          </p>
        </>
      )}
    </SiteShell>
  );
}
