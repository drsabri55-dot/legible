import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { getReportByScanId, getScan } from "@/lib/data";
import { env } from "@/lib/env";
import { deliverReport, fulfil } from "@/lib/fulfil";
import { formatUsd, reportPriceCents } from "@/lib/pricing";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false, follow: false } };

async function pay(form: FormData) {
  "use server";
  if (!env.fakePayments()) notFound();
  const scanId = String(form.get("scan") || "");
  const email = String(form.get("email") || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`/checkout/dev?scan=${scanId}&bad=1`);
  const { report, created } = await fulfil({
    scanId,
    email,
    stripeSessionId: null,
    amountCents: reportPriceCents(),
    currency: "usd",
  });
  if (created) await deliverReport(report, email);
  redirect(`/report/${report.token}?welcome=1`);
}

// Development only (ALLOW_FAKE_PAYMENTS=true and no Stripe key): stands in for
// Stripe Checkout so the whole purchase flow can be tried locally.
export default async function DevCheckout(props: PageProps<"/checkout/dev">) {
  if (!env.fakePayments()) notFound();
  const sp = await props.searchParams;
  const scan = await getScan(typeof sp.scan === "string" ? sp.scan : "");
  if (!scan || scan.status !== "complete") notFound();
  if (await getReportByScanId(scan.id)) redirect(`/scan/${scan.id}`);

  return (
    <SiteShell width="narrow">
      <Kicker>Test checkout</Kicker>
      <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">Development payment</h1>
      <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
        This page replaces Stripe while no Stripe key is set. No money moves. It runs the same steps as a real
        payment: the report is created and the email (with the PDF) goes to the local outbox in .data/outbox.
      </p>
      <form action={pay} className="mt-8 flex flex-col gap-3">
        <input type="hidden" name="scan" value={scan.id} />
        <label htmlFor="email" className="text-[12px] text-nc-neutral-300">
          Buyer email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={scan.lead_email ?? "owner@example.com"}
          className="input input-strong"
          aria-describedby={sp.bad ? "email-err" : undefined}
        />
        {sp.bad && (
          <span id="email-err" className="text-[13px] text-nc-critical">
            Enter an email address.
          </span>
        )}
        <button type="submit" className="btn btn-primary btn-cta mt-3 self-start">
          Pay {formatUsd(reportPriceCents())} (test)
        </button>
      </form>
    </SiteShell>
  );
}
