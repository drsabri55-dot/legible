import "server-only";

// Read at call time, not import time, so `next build` works without secrets
// and a missing value fails with a clear message where it is actually needed.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const env = {
  appUrl: () => (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  sessionSecret: () => {
    const value = required("SESSION_SECRET");
    if (value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
    return value;
  },
  databaseUrl: () => required("DATABASE_URL"),
  workerUrl: () => required("WORKER_URL").replace(/\/+$/, ""),
  workerSecret: () => required("WORKER_SECRET"),
  stripeSecretKey: () => process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: () => required("STRIPE_WEBHOOK_SECRET"),
  reportPriceCents: () => Number(process.env.REPORT_PRICE_CENTS || 9900),
  resendApiKey: () => process.env.RESEND_API_KEY || "",
  emailFrom: () => process.env.EMAIL_FROM || "Legible <reports@example.com>",
  emailReplyTo: () => process.env.EMAIL_REPLY_TO || undefined,
  ownerEmail: () => process.env.OWNER_EMAIL || "",
  // Postal address shown in marketing emails (required by anti-spam law).
  companyAddress: () => process.env.COMPANY_ADDRESS || "Legible",
  // Public contact address, shown on the scanner and legal pages.
  contactEmail: () => {
    if (process.env.CONTACT_EMAIL) return process.env.CONTACT_EMAIL;
    if (process.env.EMAIL_REPLY_TO) return process.env.EMAIL_REPLY_TO;
    const m = /<([^>]+)>/.exec(process.env.EMAIL_FROM || "");
    return m ? m[1] : "";
  },
  adminEmails: () =>
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  cronSecret: () => required("CRON_SECRET"),
  isVercelProduction: () => process.env.VERCEL_ENV === "production",
  // Development conveniences. Both refuse to switch on in a Vercel deployment.
  fakePayments: () =>
    !process.env.STRIPE_SECRET_KEY && process.env.ALLOW_FAKE_PAYMENTS === "true" && process.env.VERCEL !== "1",
  allowPrivateTargets: () => process.env.ALLOW_PRIVATE_TARGETS === "1" && process.env.VERCEL !== "1",
};
