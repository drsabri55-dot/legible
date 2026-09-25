import "server-only";
import Stripe from "stripe";
import { env } from "./env";

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = env.stripeSecretKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  if (!client) client = new Stripe(key);
  return client;
}

export const PRODUCT_NAME = "Full Accessibility Report";
