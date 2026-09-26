import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ScanForm } from "@/components/ScanForm";
import { CheckoutButton } from "@/components/results/CheckoutButton";
import { IssueDetail } from "@/components/results/IssueDetail";
import { LeadForm } from "@/components/results/LeadForm";
import { ScanProgress } from "@/components/results/ScanProgress";
import { ScoreRing } from "@/components/results/ScoreRing";
import { SeverityBars } from "@/components/results/SeverityBars";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { getReportByScanId, getScan } from "@/lib/data";
import { privatePage } from "@/lib/page-meta";
import { formatUsd, reportPriceCents } from "@/lib/pricing";
import { reasonCode, reasonText } from "@/lib/report/reasons";
import { failureMessage } from "@/lib/scans";
import { siteName } from "@/lib/url";

// One database read per request, shared by the metadata and the page.
const loadScan = cache(getScan);

export async function generateMetadata(props: PageProps<"/scan/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return privatePage((await loadScan(id)) ? "Your free result" : null);
}

function Locked({ count }: { count: number }) {
  // Placeholder shapes only. The real issues are never sent to the browser
  // before payment, so there is nothing to un-blur.
  return (
    <div aria-hidden="true" className="relative mt-6 overflow-hidden rounded-[14px] border border-white/[0.07]">
      <div className="space-y-4 p-6 blur-[5px] select-none">
        {Array.from({ length: Math.min(3, Math.max(1, count)) }).map((_, i) => (
          <div key={i} className="rounded-[10px] bg-white/[0.035] p-5">
            <div className="h-[14px] w-[76px] rounded bg-nc-accent-800" />
            <div className="mt-4 h-[18px] w-[62%] rounded bg-white/15" />
            <div className="mt-3 h-[10px] w-[88%] rounded bg-white/10" />
            <div className="mt-2 h-[10px] w-[70%] rounded bg-white/10" />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="h-[54px] rounded bg-black/30" />
              <div className="h-[54px] rounded bg-black/30" />
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-nc-bg/40 to-nc-bg/90" />
    </div>
  );
}

export default async function ScanPage(props: PageProps<"/scan/[id]">) {
  const { id } = await props.params;
  const scan = await loadScan(id);
  if (!scan) notFound();

  if (scan.status === "queued" || scan.status === "running") {
    return (
      <SiteShell>
        <Kicker>Scanning</Kicker>
        <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em] break-words">{siteName(scan.host)}</h1>
        <div className="mt-8">
          <ScanProgress
            scanId={scan.id}
            host={siteName(scan.host)}
            initial={{ status: scan.status, pagesDone: scan.pages_done, pagesTotal: scan.pages_total, error: null }}
          />
        </div>
      </SiteShell>
    );
  }

  if (scan.status === "failed" || !scan.summary) {
    return (
      <SiteShell>
        <Kicker>Scan stopped</Kicker>
        <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em] break-words">{siteName(scan.host)}</h1>
        <p className="mt-6 max-w-[48ch] text-[16px] leading-[1.8] text-nc-neutral-300" role="alert">
          {failureMessage(scan.error)}
        </p>
        <div className="mt-10 max-w-[30rem]">
          <ScanForm variant="compact" />
        </div>
      </SiteShell>
    );
  }

  const s = scan.summary;
  const price = formatUsd(reportPriceCents());
  const hidden = Math.max(0, s.issueTypes - s.samples.length);
  const report = await getReportByScanId(scan.id);
  const scannedPages = s.pages.filter((p) => p.status === "scanned");
  // Pages we tried but could not scan, grouped by reason.
  const notScanned = new Map<string, number>();
  for (const p of s.pages) {
    if (p.status === "scanned") continue;
    const code = reasonCode(p.reason);
    notScanned.set(code, (notScanned.get(code) ?? 0) + 1);
  }

  return (
    <SiteShell>
      <Kicker>Free result</Kicker>
      <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-6">
        <ScoreRing score={s.score} />
        <div className="min-w-0 flex-[1_1_18rem]">
          <h1 className="m-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em] break-words">{s.site}</h1>
          {s.redirectedTo && (
            <p className="mt-2 mb-0 text-[13px] text-nc-neutral-400 break-words">
              This address redirects to {s.redirectedTo}, so that is what we scanned.
            </p>
          )}
          <p className="mt-3 mb-0 max-w-[46ch] text-[15px] leading-[1.8] text-nc-neutral-300">
            Scored {s.score ?? "–"} out of 100, measured against WCAG 2.1 Level AA across {s.pagesScanned}{" "}
            {s.pagesScanned === 1 ? "page" : "pages"}. The score is a guide, not a certificate: automated checks cannot
            test everything.
          </p>
        </div>
      </div>

      <section aria-labelledby="count" className="mt-14">
        <h2 id="count" className="m-0 flex flex-wrap items-baseline gap-[18px]">
          <span className="text-[clamp(56px,8vw,96px)] leading-[0.94] tracking-[-0.04em] tabular-nums">
            {s.totalIssues}
          </span>
          <span className="text-[clamp(15px,1.3vw,19px)] font-normal text-nc-neutral-300">
            {s.totalIssues === 1 ? "failure" : "failures"}, in {s.issueTypes} {s.issueTypes === 1 ? "kind" : "kinds"} of issue
          </span>
        </h2>
        <div className="mt-8">
          <SeverityBars counts={s.counts} />
        </div>
        <p className="mt-6 text-[14px] text-nc-neutral-400">
          Kinds of issue by group: must fix {s.groupCounts.must}, should fix {s.groupCounts.should}, nice to have{" "}
          {s.groupCounts.nice}
        </p>
      </section>

      {s.totalIssues === 0 ? (
        <section className="mt-14 max-w-[52ch]">
          <h2 className="m-0 text-[24px] tracking-[-0.02em]">No failures found by the automated checks</h2>
          <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
            That is a good sign. Automated testing cannot check everything, such as whether image descriptions are
            accurate or whether the site works with a keyboard alone, so a manual review is still worth doing.
          </p>
        </section>
      ) : (
        <section aria-labelledby="samples" className="mt-16">
          <h2 id="samples" className="m-0 text-[clamp(24px,2.6vw,32px)] leading-[1.2] tracking-[-0.02em]">
            Two of your issues, in full
          </h2>
          <p className="mt-3 max-w-[56ch] text-[14px] leading-[1.8] text-nc-neutral-400">
            This is what every issue looks like in the full report. Text in [square brackets] is for you to fill in.
          </p>
          <div className="mt-8 space-y-6">
            {s.samples.map((issue) => (
              <IssueDetail key={issue.ruleId} issue={issue} />
            ))}
          </div>
          {hidden > 0 && <Locked count={hidden} />}
        </section>
      )}

      <section aria-labelledby="full" className="mt-10 rounded-[14px] border border-nc-accent-700 bg-nc-accent-900/40 p-[clamp(20px,3vw,32px)]">
        {report ? (
          <>
            <h2 id="full" className="m-0 text-[22px] tracking-[-0.02em]">
              The full report for this scan has been bought
            </h2>
            <p className="mt-3 mb-0 text-[14.5px] leading-[1.8] text-nc-neutral-300">
              It was emailed to the buyer. If that is you, <Link href="/account">sign in to your account</Link> to open it.
            </p>
          </>
        ) : (
          <>
            <h2 id="full" className="m-0 text-[clamp(22px,2.4vw,28px)] tracking-[-0.02em]">
              {hidden > 0
                ? `${hidden} more ${hidden === 1 ? "issue" : "issues"} in the full report`
                : "Get the full report"}
            </h2>
            <ul className="mt-5 mb-0 grid list-none gap-3 p-0 text-[14.5px] leading-[1.7] text-nc-neutral-200 sm:grid-cols-2">
              {[
                "Every failure, with the element, the page and corrected code",
                "Sorted into must fix, should fix and nice to have",
                "A plain-English summary you can forward to your team",
                "A PDF and a link you can share, dated for your records",
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden="true" className="mt-[11px] block h-px w-[18px] shrink-0 bg-nc-accent-500" />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
              <CheckoutButton scanId={scan.id} label={`Get the full report · ${price}`} />
              <p className="m-0 self-start pt-[10px] text-[13px] text-nc-neutral-400">One-time payment. No subscription.</p>
            </div>
          </>
        )}
      </section>

      <section className="mt-12 grid gap-10 md:grid-cols-2">
        <div>
          <LeadForm scanId={scan.id} alreadySent={!!scan.lead_email} />
        </div>
        <div>
          <h2 className="m-0 text-[12px] font-normal uppercase tracking-[0.16em] text-nc-neutral-400">Pages scanned</h2>
          <ul className="mt-3 mb-0 list-none space-y-[6px] p-0 text-[13px] leading-[1.6] text-nc-neutral-300">
            {scannedPages.map((p) => (
              <li key={p.url} className="break-all">
                {p.url}
              </li>
            ))}
          </ul>
          {notScanned.size > 0 && (
            <ul className="mt-4 mb-0 list-none space-y-[6px] p-0 text-[13px] leading-[1.6] text-nc-neutral-400">
              {[...notScanned].map(([code, n]) => (
                <li key={code}>
                  {n} more {n === 1 ? "page" : "pages"} not scanned: {reasonText(code)}.
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="mt-12 max-w-[62ch] text-[12.5px] leading-[1.7] text-nc-neutral-500">
        Scanned {scan.finished_at ? new Date(scan.finished_at).toUTCString().replace(" GMT", " UTC") : ""}.{" "}
        <Link href="/">Scan another site</Link>
      </p>
    </SiteShell>
  );
}
