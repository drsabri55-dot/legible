import { after } from "next/server";
import type Stripe from "stripe";
import { forgetStripeEvent, recordStripeEvent } from "@/lib/data";
import { alertOwner } from "@/lib/email/send";
import { env } from "@/lib/env";
import { deliverReport, fulfil } from "@/lib/fulfil";
import { json } from "@/lib/http";
import { stripe } from "@/lib/stripe";

export const maxDuration = 60;

// Stripe → us. Verified with the webhook signing secret. Each event ID is
// recorded before acting, so a repeated delivery is acknowledged and ignored.
// If acting fails, the record is removed and Stripe retries later.
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing signature" }, 400);
  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, env.stripeWebhookSecret());
  } catch {
    return json({ error: "Invalid signature" }, 400);
  }

  const relevant = event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
  if (!relevant) return json({ received: true });

  if (!(await recordStripeEvent(event.id, event.type))) return json({ received: true, duplicate: true });

  try {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== "paid") return json({ received: true, pending: true });
    const scanId = session.metadata?.scan_id;
    const email = session.customer_details?.email || session.customer_email;
    if (!scanId || !email) throw new Error(`Session ${session.id} has no scan_id or email`);
    const { report, created } = await fulfil({
      scanId,
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
          await alertOwner("A paid report email failed", `${scanId} → ${email}: ${(e as Error).message}`);
        }
      });
    }
    return json({ received: true });
  } catch (e) {
    await forgetStripeEvent(event.id);
    await alertOwner("A Stripe payment could not be fulfilled", `${event.id}: ${(e as Error).message}`);
    return json({ error: "Fulfilment failed" }, 500);
  }
}
