import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { recentFailures, stats } from "@/lib/data";
import { env } from "@/lib/env";
import { privatePage } from "@/lib/page-meta";
import { formatUsd } from "@/lib/pricing";
import { getSessionEmail } from "@/lib/session";

async function isAdmin(): Promise<boolean> {
  const email = await getSessionEmail();
  return !!email && env.adminEmails().includes(email);
}

// Everyone else sees an ordinary "Page not found", title included.
export async function generateMetadata(): Promise<Metadata> {
  return privatePage((await isAdmin()) ? "Owner dashboard" : null);
}

function pct(a: number, b: number): string {
  return b ? `${((100 * a) / b).toFixed(1)}%` : "–";
}

// The one metric that matters (brief §13): paid reports ÷ free scans.
export default async function AdminPage() {
  if (!(await isAdmin())) notFound();
  const [rows, failures] = await Promise.all([stats(), recentFailures()]);

  return (
    <SiteShell width="wide">
      <Kicker>Owner dashboard</Kicker>
      <h1 className="mt-6 text-[clamp(28px,3.6vw,40px)] tracking-[-0.025em]">How the funnel is doing</h1>
      <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.8] text-nc-neutral-400">
        Conversion is paid reports divided by free scans started. Under 3 in 100 means the result page is not
        convincing enough: change the sales page, not the scanner.
      </p>
      {/* Scrolls sideways on phones, so it takes keyboard focus and has a name. */}
      <div className="mt-8 overflow-x-auto" tabIndex={0} role="region" aria-labelledby="funnel-caption">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <caption id="funnel-caption" className="sr-only">
            Scans, sales and conversion by period
          </caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-nc-neutral-400">
              {["Period", "Scans", "Completed", "Failed", "Paid", "Conversion", "Revenue", "Leads", "Monitoring"].map((h) => (
                <th key={h} scope="col" className="border-b border-white/10 py-2 pr-4 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period} className="border-b border-white/[0.06] tabular-nums">
                <th scope="row" className="py-3 pr-4 text-left font-normal whitespace-nowrap text-nc-neutral-200">
                  {r.period}
                </th>
                <td className="py-3 pr-4">{r.scans}</td>
                <td className="py-3 pr-4">{r.completed}</td>
                <td className="py-3 pr-4">{r.failed}</td>
                <td className="py-3 pr-4">{r.paid}</td>
                <td className="py-3 pr-4 text-nc-accent-300">{pct(r.paid, r.scans)}</td>
                <td className="py-3 pr-4">{formatUsd(r.revenue_cents)}</td>
                <td className="py-3 pr-4">{r.leads}</td>
                <td className="py-3 pr-4">{r.monitoring_requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-14 text-[20px] tracking-[-0.015em]">Recent failed scans</h2>
      {failures.length === 0 ? (
        <p className="text-[14px] text-nc-neutral-400">None.</p>
      ) : (
        <ul className="mt-4 list-none space-y-2 p-0 text-[14px]">
          {failures.map((f) => (
            <li key={f.id} className="flex flex-wrap gap-x-4 text-nc-neutral-300">
              <a href={`/scan/${f.id}`} className="inline-flex min-h-6 items-center">
                {f.host}
              </a>
              <span className="text-nc-neutral-400">{f.error}</span>
              <span className="text-nc-neutral-500">{new Date(f.created_at).toUTCString()}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-12 text-[13px] text-nc-neutral-500">
        To stop scanning a site whose owner asked, add its address to the blocked_domains table in Supabase.
      </p>
    </SiteShell>
  );
}
