import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { privatePage } from "@/lib/page-meta";
import { renderEmail, TEMPLATES } from "@/lib/email/render";

export const metadata: Metadata = privatePage(process.env.NODE_ENV === "production" ? null : "Email templates");

// Development only: every email template with sample values.
const SAMPLE = {
  link: "http://localhost:3000/auth/verify?token=example",
  email: "owner@example.com",
  site: "yourbusiness.com",
  score: 68,
  total: 143,
  pages: 6,
  must: 4,
  result_link: "http://localhost:3000/scan/example",
  report_link: "http://localhost:3000/report/example",
  account_link: "http://localhost:3000/account",
  price: "$99",
  amount: "$99",
  app_url: "localhost:3000",
  price_monthly: "$39",
  monitor_link: "http://localhost:3000/monitoring?r=example",
  unsubscribe_link: "http://localhost:3000/unsubscribe?e=owner%40example.com&s=example",
  company_address: "Legible, 1 Example Street, Example City",
  previous_score: 61,
  fixed: 12,
  new: 2,
  subject: "A scan of yourbusiness.com failed",
  message: "worker_unavailable: Worker unreachable",
};

export default async function EmailPreviews() {
  if (process.env.NODE_ENV === "production") notFound();
  const emails = await Promise.all(TEMPLATES.map(async (t) => ({ name: t, ...(await renderEmail(t, SAMPLE)) })));
  return (
    <main id="main" className="mx-auto max-w-[760px] px-6 py-12">
      <h1 className="text-[28px]">Email templates</h1>
      {emails.map((e) => (
        <section key={e.name} className="mt-10">
          <h2 className="text-[16px] text-nc-neutral-300">
            {e.name}.html · <span className="text-nc-neutral-100">{e.subject}</span>
          </h2>
          <iframe title={`${e.name} preview`} srcDoc={e.html} className="mt-3 h-[560px] w-full rounded-[8px] bg-white" />
        </section>
      ))}
    </main>
  );
}
