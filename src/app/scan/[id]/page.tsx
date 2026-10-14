import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ScanForm } from "@/components/ScanForm";
import { Chat } from "@/components/chat/Chat";
import { AgentCapNote } from "@/components/results/AgentNote";
import { CheckoutButton } from "@/components/results/CheckoutButton";
import { FixPlan } from "@/components/results/FixPlan";
import { IssueDetail } from "@/components/results/IssueDetail";
import { LeadForm } from "@/components/results/LeadForm";
import { ReportPreview } from "@/components/results/ReportPreview";
import { ScanProgress } from "@/components/results/ScanProgress";
import { ScoreRing } from "@/components/results/ScoreRing";
import { SeverityBars } from "@/components/results/SeverityBars";
import { Kicker, SiteShell } from "@/components/site/SiteShell";
import { chatState } from "@/lib/chat/ask";
import { chatEnabled } from "@/lib/chat/limits";
import { getReportByScanId, getScan, getScanRaw } from "@/lib/data";
import { privatePage } from "@/lib/page-meta";
import { buildReport, reportForSale } from "@/lib/report/model";
import { formatUsd, reportPriceCents } from "@/lib/pricing";
import { reasonCode, reasonText } from "@/lib/report/reasons";
import { failureMessage } from "@/lib/scans";
import { siteName } from "@/lib/url";

// One database read per request, shared by the metadata and the page.
const loadScan = cache(getScan);

// The tab title follows the scan, so a screen reader announces "Scanning…"
// rather than a result that does not exist yet.
export async function generateMetadata(props: PageProps<"/scan/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const scan = await loadScan(id);
  if (!scan) return privatePage(null);
  if (scan.status === "queued" || scan.status === "running") return privatePage(`Scanning ${siteName(scan.host)}`);
  return privatePage(scan.status === "failed" || !scan.summary ? "Scan stopped" : "Your free result");
}

export default async function ScanPage(props: PageProps<"/scan/[id]">) {
  const { id } = await props.params;
  const scan = await loadScan(id);
  if (!scan) notFound();

  if (scan.status === "queued" || scan.status === "running") {
    return (
      <SiteShell>
        <Kicker>Scanning</Kicker>
        <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em] break-words">
          {siteName(scan.host)}
        </h1>
        <div className="mt-8">
          <ScanProgress
            scanId={scan.id}
            host={siteName(scan.host)}
            agent={scan.agent === "on"}
            initial={{ status: scan.status, pagesDone: scan.pages_done, pagesTotal: scan.pages_total, error: null }}
          />
        </div>
        {scan.agent === "on" && chatEnabled() && (
          <Chat scanId={scan.id} place="scan" anchors={[]} offer={null} initial={await chatState(scan)} />
        )}
      </SiteShell>
    );
  }

  if (scan.status === "failed" || !scan.summary) {
    return (
      <SiteShell>
        <Kicker>Scan stopped</Kicker>
        <h1 className="mt-6 mb-0 text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-[-0.025em] break-words">
          {siteName(scan.host)}
        </h1>
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
  const clean = s.totalIssues === 0;
  const review = s.needsReview ?? [];
  const price = formatUsd(reportPriceCents());
  // Everything on the free result is built from the stored scan, so every
  // problem and its fix is shown (older summaries held only two).
  const raw = await getScanRaw(scan.id);
  const full = raw ? buildReport(raw) : null;
  const issues = full?.issues ?? s.samples;
  const report = await getReportByScanId(scan.id);
  const scannedPages = s.pages.filter((p) => p.status === "scanned");
  // Questions about this result: 5 free. Answers may link to the plan and to
  // each problem below.
  const chat = chatEnabled() ? (
    <Chat
      scanId={scan.id}
      place="result"
      anchors={["plan", ...issues.map((i) => `issue-${i.ruleId}`)]}
      offer={!report && reportForSale(s) ? { label: `Test the whole site · ${price}` } : null}
      initial={await chatState(scan)}
    />
  ) : null;
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
          <AgentCapNote mode={scan.agent} />
        </div>
      </div>

      <section aria-labelledby="count" className="mt-14">
        <h2 id="count" className="m-0 flex flex-wrap items-baseline gap-[18px]">
          <span className="text-[clamp(56px,8vw,96px)] leading-[0.94] tracking-[-0.04em] tabular-nums">
            {s.totalIssues}
          </span>
          <span className="text-[clamp(15px,1.3vw,19px)] font-normal text-nc-neutral-300">
            {clean
              ? "failures found"
              : `${s.totalIssues === 1 ? "failure" : "failures"}, in ${s.issueTypes} ${s.issueTypes === 1 ? "kind" : "kinds"} of issue`}
          </span>
        </h2>
        {!clean && (
          <>
            <div className="mt-8">
              <SeverityBars counts={s.counts} />
            </div>
            <p className="mt-6 text-[14px] text-nc-neutral-400">
              Kinds of issue by group: must fix {s.groupCounts.must}, should fix {s.groupCounts.should}, nice to have{" "}
              {s.groupCounts.nice}
            </p>
          </>
        )}
      </section>

      {clean ? (
        <>
          <section aria-labelledby="clean" className="mt-14 max-w-[56ch]">
            <h2 id="clean" className="m-0 text-[24px] tracking-[-0.02em]">
              No failures found by the automated checks
            </h2>
            <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
              That is a good sign. There is no report to buy, because it would only repeat this page.
            </p>
            <p className="mt-4 text-[15px] leading-[1.8] text-nc-neutral-300">
              Automated testing cannot check everything, such as whether image descriptions are accurate or whether the
              site works with a keyboard alone. A manual review is still worth doing.
            </p>
            {review.length > 0 && (
              <>
                <h3 className="mt-10 mb-0 text-[18px] font-normal tracking-[-0.01em]">Checks that need a person</h3>
                <p className="mt-3 text-[14px] leading-[1.8] text-nc-neutral-400">
                  The scanner found these possible problems but could not confirm them on its own, for example text over
                  a background image. They are not counted as failures or in the score. Ask whoever reviews the site to
                  look at them.
                </p>
                <ul className="mt-4 mb-0 list-none space-y-[8px] p-0 text-[14.5px] leading-[1.6] text-nc-neutral-200">
                  {review.map((n) => (
                    <li key={n.ruleId} className="flex gap-3">
                      <span aria-hidden="true" className="mt-[11px] block h-px w-[18px] shrink-0 bg-nc-accent-500" />
                      <span>
                        {n.title}:{" "}
                        <span className="text-nc-neutral-400">
                          {n.instances} {n.instances === 1 ? "element" : "elements"} to check
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          {chat}
        </>
      ) : (
        <>
          {full && <FixPlan plan={full.plan} builtWith={full.builtWith} />}
          {chat}
          {full && full.agentReviews.length > 0 && (
            <section aria-labelledby="worth" className="mt-14">
              <h2 id="worth" className="m-0 text-[clamp(20px,2vw,24px)] leading-[1.25] tracking-[-0.015em]">
                Worth checking
              </h2>
              <p className="mt-3 max-w-[56ch] text-[14px] leading-[1.8] text-nc-neutral-400">
                The testing agent flagged these as likely problems and checked each one twice. They are its judgement,
                not measured failures, so they are not in the score or the plan.
              </p>
              <ul className="mt-4 mb-0 list-none space-y-[12px] p-0">
                {full.agentReviews.map((v, i) => (
                  <li key={i} className="border-t border-white/[0.07] pt-[12px] text-[14.5px] leading-[1.7]">
                    <span className="text-nc-neutral-100">{v.title}</span>
                    <span className="block text-nc-neutral-300">{v.reason}</span>
                    <span className="block text-[12px] text-nc-neutral-500 break-all">
                      {v.pageUrl} at <code className="text-nc-neutral-400">{v.selector}</code>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="problems" className="mt-16">
            <h2 id="problems" className="m-0 text-[clamp(24px,2.6vw,32px)] leading-[1.2] tracking-[-0.02em]">
              Every problem, with its fix
            </h2>
            <p className="mt-3 max-w-[56ch] text-[14px] leading-[1.8] text-nc-neutral-400">
              Each problem shows code from your site and a fix. A tested fix passed the same check in a browser. Text in
              [square brackets] is for you to fill in.
            </p>
            <div className="mt-8 space-y-6">
              {issues.map((issue) => (
                <IssueDetail key={issue.ruleId} issue={issue} />
              ))}
            </div>
          </section>
        </>
      )}

      {(report || reportForSale(s)) && (
        <section
          aria-labelledby="full"
          className="mt-10 rounded-[14px] border border-nc-accent-700 bg-nc-accent-900/40 p-[clamp(20px,3vw,32px)]"
        >
          {report ? (
            <>
              <h2 id="full" className="m-0 text-[22px] tracking-[-0.02em]">
                The full report for this scan has been bought
              </h2>
              <p className="mt-3 mb-0 text-[14.5px] leading-[1.8] text-nc-neutral-300">
                It was emailed to the buyer. If that is you, <Link href="/account">sign in to your account</Link> to
                open it.
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-8 md:flex-row md:items-center md:gap-10">
              <div className="min-w-0 flex-1">
                <h2 id="full" className="m-0 text-[clamp(22px,2.4vw,28px)] tracking-[-0.02em]">
                  Test your whole site
                </h2>
                <ul className="mt-5 mb-0 grid list-none gap-3 p-0 text-[14.5px] leading-[1.7] text-nc-neutral-200 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                  {[
                    "Every page of your site, up to 50, tested the same way",
                    "A fix for every problem, and one plan for the whole site",
                    "A PDF and a link you can share, dated for your records",
                    "Sorted into must fix, should fix and nice to have",
                  ].map((line) => (
                    <li key={line} className="flex gap-3">
                      <span aria-hidden="true" className="mt-[11px] block h-px w-[18px] shrink-0 bg-nc-accent-500" />
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <CheckoutButton scanId={scan.id} label={`Test the whole site · ${price}`} />
                  <p className="m-0 self-start pt-[10px] text-[13px] text-nc-neutral-400">
                    One-time payment. No subscription.
                  </p>
                </div>
              </div>
              <ReportPreview />
            </div>
          )}
        </section>
      )}

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
