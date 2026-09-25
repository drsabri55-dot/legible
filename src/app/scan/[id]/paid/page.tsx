import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { getScan } from "@/lib/data";
import { alertOwner } from "@/lib/email/send";
import { env } from "@/lib/env";
import { deliverReport, fulfil } from "@/lib/fulfil";
import { stripe } from "@/lib/stripe";

export const metadata: Metadata = { title: "Payment received", robots: { index: false, follow: false } };
export const maxDuration = 60;

// Stripe sends the buyer here after paying. The webhook usually gets there
// first; either way, fulfil() only creates one report.
export default async function PaidPage(props: PageProps<"/scan/[id]/paid">) {
  const { id } = await props.params;
  const { session_id } = await props.searchParams;
  const scan = await getScan(id);
  if (!scan || typeof session_id !== "string" || !env.stripeSecretKey()) notFound();

  let token: string | null = null;
  let problem: "pending" | "error" | null = null;
  try {
    const session = await stripe().checkout.sessions.retrieve(session_id);
    if (session.metadata?.scan_id !== scan.id) notFound();
    const email = session.customer_details?.email || session.customer_email;
    if (session.payment_status !== "paid" || !email) {
      problem = "pending";
    } else {
      const { report, created } = await fulfil({
        scanId: scan.id,
        email,
        stripeSessionId: session.id,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
      });
      if (created) {
        after(async () => {
          try {
            await deliverReport(report, email.toLowerCase());
          } catch (e) {
            await alertOwner("A paid report email failed", `${scan.id} → ${email}: ${(e as Error).message}`);
          }
        });
      }
      token = report.token;
    }
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_")) throw e;
    console.error("[paid]", e);
    problem = "error";
  }

  if (token) redirect(`/report/${token}?welcome=1`);
  const contact = env.contactEmail();

  return (
    <SiteShell width="narrow">
      <Kicker>Payment</Kicker>
      {problem === "pending" ? (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">Your payment is being confirmed</h1>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            Some payment methods take a few minutes to clear. We will email the report for {scan.host} as soon as it
            does. You can close this page.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-[32px] leading-[1.15] tracking-[-0.02em]">We could not open your report yet</h1>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            If your payment went through, the report will reach you by email in the next few minutes.
            {contact ? (
              <>
                {" "}
                If it does not arrive, email <a href={`mailto:${contact}`}>{contact}</a> and we will sort it out.
              </>
            ) : (
              " If it does not arrive, reply to any Legible email and we will sort it out."
            )}
          </p>
        </>
      )}
      <p className="mt-8 text-[14px]">
        <Link href="/account">Go to your reports</Link>
      </p>
    </SiteShell>
  );
}
