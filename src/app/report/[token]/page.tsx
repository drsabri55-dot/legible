import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getReportByToken } from "@/lib/data";
import { buildReport, type Issue, type Report } from "@/lib/report/model";
import type { Effort, Impact } from "@/lib/rules/catalogue";
import { understandingUrl } from "@/lib/rules/wcag";
import "./report.css";

export const metadata: Metadata = { title: "Accessibility report", robots: { index: false, follow: false } };

const IMPACT_LABEL: Record<Impact, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};
const EFFORT_LABEL: Record<Effort, string> = {
  quick: "Quick fix",
  moderate: "An hour or two",
  involved: "Needs content or design work",
};
const GROUP_INTRO: Record<string, string> = {
  must: "Critical failures. Each one stops some people from completing a task at all. Fix these first.",
  should: "Serious failures. They make the site hard to use for some people.",
  nice: "Moderate and minor failures. They add friction. They still fail WCAG 2.1 AA, so fix them once the others are done.",
};
const PAGE_REASON: Record<string, string> = {
  robots: "Skipped: the site's robots.txt asks tools like ours not to visit it",
  unreachable: "Could not be loaded",
  timeout: "Took too long to load",
  not_html: "Not a web page",
  blocked_target: "Points to an address we do not scan",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function reasonText(reason: string | null): string {
  if (!reason) return "";
  const code = reason.split(":")[0];
  return PAGE_REASON[code] ?? "Could not be scanned";
}

function Mark() {
  return (
    <span className="rp-mark" aria-hidden="true">
      <span />
    </span>
  );
}

function Pill({ impact }: { impact: Impact }) {
  return <span className={`rp-pill rp-${impact}`}>{IMPACT_LABEL[impact]}</span>;
}

function Summary({ r }: { r: Report }) {
  const must = r.groups[0].issues.length;
  const pagesWord = r.pagesScanned === 1 ? "page" : "pages";
  const start = r.issues.slice(0, 5);
  return (
    <section className="rp-section rp-break" aria-labelledby="summary">
      <p className="rp-kicker">Summary</p>
      <h2 id="summary">{r.site} at a glance</h2>
      <p className="rp-lede">
        {r.site} scored {r.score ?? "–"} out of 100. We found {r.totalIssues}{" "}
        {r.totalIssues === 1 ? "failure" : "failures"} across {r.pagesScanned} {pagesWord}, in {r.issues.length}{" "}
        {r.issues.length === 1 ? "kind" : "kinds"} of issue.{" "}
        {r.totalIssues === 0
          ? "The automated checks found nothing to fix. The limitations page explains what still needs a person to check."
          : must > 0
            ? `${must} of those ${must === 1 ? "kind is" : "kinds are"} in the must-fix group: ${must === 1 ? "it stops" : "they stop"} some people from using the site at all.`
            : "None of them is critical, so the site can be used, but some people will find parts of it hard."}
      </p>

      <dl className="rp-tiles">
        <div>
          <dt>Score</dt>
          <dd>{r.score ?? "–"}</dd>
        </div>
        <div>
          <dt>Failures</dt>
          <dd>{r.totalIssues}</dd>
        </div>
        {r.groups.map((g) => (
          <div key={g.key}>
            <dt>{g.label}</dt>
            <dd>{g.issues.length}</dd>
          </div>
        ))}
      </dl>

      {start.length > 0 && (
        <>
          <h3>Start here</h3>
          <p>The issues below affect the most people. Fixing them closes most of the gap.</p>
          <ol className="rp-start">
            {start.map((i) => (
              <li key={i.ruleId}>
                <a href={`#issue-${i.ruleId}`}>{i.title}</a>
                <span>
                  {IMPACT_LABEL[i.impact]} · {i.instances} {i.instances === 1 ? "element" : "elements"} ·{" "}
                  {EFFORT_LABEL[i.effort]}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      <h3>How to read this report</h3>
      <ul className="rp-plain">
        <li>
          <strong>Must fix</strong>: {GROUP_INTRO.must}
        </li>
        <li>
          <strong>Should fix</strong>: {GROUP_INTRO.should}
        </li>
        <li>
          <strong>Nice to have</strong>: {GROUP_INTRO.nice}
        </li>
        <li>
          Each issue shows code from your site and a corrected version. Text in [square brackets] is for you to write,
          such as a description of an image. Give these pages to whoever builds your site.
        </li>
      </ul>
    </section>
  );
}

function Pages({ r }: { r: Report }) {
  return (
    <section className="rp-section" aria-labelledby="pages">
      <p className="rp-kicker">Scope</p>
      <h2 id="pages">Pages scanned</h2>
      <p>
        Legible scanned the home page and up to five pages linked from its navigation on {formatDate(r.scannedAt)}.
      </p>
      <table className="rp-table">
        <thead>
          <tr>
            <th scope="col">Page</th>
            <th scope="col" className="rp-num">
              Failures
            </th>
          </tr>
        </thead>
        <tbody>
          {r.pages.map((p) => (
            <tr key={p.url}>
              <td>
                <span className="rp-url">{p.url}</span>
                {p.title && <span className="rp-sub">{p.title}</span>}
                {p.status !== "scanned" && <span className="rp-sub">{reasonText(p.reason)}</span>}
              </td>
              <td className="rp-num">{p.status === "scanned" ? p.issues : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function IssueBlock({ issue, n }: { issue: Issue; n: string }) {
  return (
    <article className="rp-issue" id={`issue-${issue.ruleId}`} aria-labelledby={`t-${issue.ruleId}`}>
      <header className="rp-issue-head">
        <span className="rp-issue-n">{n}</span>
        <div>
          <h3 id={`t-${issue.ruleId}`}>{issue.title}</h3>
          <p className="rp-meta">
            <Pill impact={issue.impact} />
            <span>
              {issue.instances} {issue.instances === 1 ? "element" : "elements"} on {issue.pages.length}{" "}
              {issue.pages.length === 1 ? "page" : "pages"}
            </span>
            <span>{EFFORT_LABEL[issue.effort]}</span>
          </p>
        </div>
      </header>
      <dl className="rp-facts">
        <dt>What is wrong</dt>
        <dd>{issue.summary}</dd>
        <dt>Why it matters</dt>
        <dd>{issue.why}</dd>
        <dt>Who it affects</dt>
        <dd>{issue.who}</dd>
        <dt>How to fix it</dt>
        <dd>{issue.fix}</dd>
        <dt>WCAG 2.1</dt>
        <dd>
          {issue.criteria.length
            ? issue.criteria.map((c, i) => (
                <span key={c.sc}>
                  {i > 0 && "; "}
                  <a href={understandingUrl(c.sc)}>
                    {c.sc} {c.name}
                  </a>{" "}
                  (Level {c.level})
                </span>
              ))
            : "WCAG 2.1 Level A/AA"}
        </dd>
      </dl>

      {issue.examples.map((ex, i) => (
        <div className="rp-example" key={i}>
          <p className="rp-where">
            <span>{ex.pageUrl}</span>
            <code>{ex.selector}</code>
          </p>
          <div className={ex.fixed ? "rp-code-pair" : "rp-code-pair rp-single"}>
            <figure>
              <figcaption>Your code</figcaption>
              <pre>
                <code>{ex.html}</code>
              </pre>
            </figure>
            {ex.fixed && (
              <figure>
                <figcaption>Corrected</figcaption>
                <pre className="rp-good">
                  <code>{ex.fixed}</code>
                </pre>
              </figure>
            )}
          </div>
          {ex.note && issue.examples.findIndex((other) => other.note === ex.note) === i && (
            <p className="rp-note">{ex.note}</p>
          )}
        </div>
      ))}

      {issue.examples.some((ex) => !ex.fixed) && issue.genericBefore && (
        <div className="rp-example">
          <p className="rp-where">
            <span>How the fix looks in general</span>
          </p>
          <div className="rp-code-pair">
            <figure>
              <figcaption>Before</figcaption>
              <pre>
                <code>{issue.genericBefore}</code>
              </pre>
            </figure>
            <figure>
              <figcaption>After</figcaption>
              <pre className="rp-good">
                <code>{issue.genericAfter}</code>
              </pre>
            </figure>
          </div>
        </div>
      )}

      {issue.moreSelectors.length > 0 && (
        <div className="rp-more">
          <p>
            <strong>For your developer:</strong> {issue.instances - issue.examples.length} more{" "}
            {issue.instances - issue.examples.length === 1 ? "element" : "elements"} with the same problem
            {issue.instances - issue.examples.length > issue.moreSelectors.length
              ? `, including these ${issue.moreSelectors.length}`
              : ""}
            :
          </p>
          <ul>
            {issue.moreSelectors.map((m, i) => (
              <li key={i}>
                <code>{m.selector}</code> <span>on {m.pageUrl}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function Issues({ r }: { r: Report }) {
  let groupIndex = 0;
  return (
    <>
      {r.groups.map((g) => {
        if (!g.issues.length) return null;
        groupIndex++;
        const gi = groupIndex;
        return (
          <section key={g.key} className="rp-section rp-break" aria-labelledby={`g-${g.key}`}>
            <p className="rp-kicker">
              Group {gi} · {g.issues.length} {g.issues.length === 1 ? "issue" : "issues"}
            </p>
            <h2 id={`g-${g.key}`}>{g.label}</h2>
            <p className="rp-lede">{GROUP_INTRO[g.key]}</p>
            {g.issues.map((issue, i) => (
              <IssueBlock key={issue.ruleId} issue={issue} n={`${gi}.${i + 1}`} />
            ))}
          </section>
        );
      })}
    </>
  );
}

function Review({ r }: { r: Report }) {
  if (!r.needsReview.length) return null;
  return (
    <section className="rp-section rp-break" aria-labelledby="review">
      <p className="rp-kicker">Needs a human check</p>
      <h2 id="review">Checks we could not finish automatically</h2>
      <p>
        For these checks the scanner found something it could not judge on its own, for example text over a background
        image, where the contrast depends on the image. They are not counted as failures or in the score. Ask whoever
        reviews the site to look at them.
      </p>
      <table className="rp-table">
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col" className="rp-num">
              Elements
            </th>
          </tr>
        </thead>
        <tbody>
          {r.needsReview.map((n) => (
            <tr key={n.ruleId}>
              <td>{n.title}</td>
              <td className="rp-num">{n.instances}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Method({ r }: { r: Report }) {
  return (
    <section className="rp-section rp-break" aria-labelledby="method">
      <p className="rp-kicker">Method</p>
      <h2 id="method">How this report was made</h2>
      <p>
        Legible loaded each page in a Chromium browser and ran axe-core {r.engine.axe}, an open-source accessibility
        testing engine, with its rules for WCAG 2.0 and 2.1 at Levels A and AA. {r.rulesPassed + r.rulesFailed} of those
        rules applied to the pages scanned: {r.rulesPassed} passed and {r.rulesFailed} failed.
      </p>
      <h3>How the score works</h3>
      <p>
        Each rule that applied to the site counts once, weighted by how badly a failure affects people: critical 10,
        serious 7, moderate 3, minor 1. The score is the weighted share of those rules the site passed on every page
        scanned. A rule that failed on any page counts as failed. The score shows progress; it is not a pass mark.
      </p>
      <h3>The scanner</h3>
      <p>
        The scanner identifies itself as LegibleBot, follows the site&rsquo;s robots.txt and waits between pages. It
        does not submit forms, log in or change anything on the site.
      </p>
    </section>
  );
}

function Limitations({ r }: { r: Report }) {
  return (
    <section className="rp-section rp-break rp-limits" aria-labelledby="limits">
      <p className="rp-kicker">Limitations</p>
      <h2 id="limits">What this report can and cannot tell you</h2>
      <ul className="rp-plain">
        <li>
          Automated testing checks only part of WCAG 2.1. Many success criteria need a person to judge them: whether alt
          text describes an image accurately, whether headings and labels make sense, whether captions match what is
          said, whether every task can be done with a keyboard alone, and whether the content is easy to understand.
        </li>
        <li>
          This report covers the {r.pagesScanned} {r.pagesScanned === 1 ? "page" : "pages"} listed under Pages scanned,
          as they were on {formatDate(r.scannedAt)}. Other pages, content behind a login, and changes made since then
          are not covered.
        </li>
        <li>
          Some checks could not be completed automatically. They are listed under &ldquo;Needs a human check&rdquo; where
          there were any, and are not counted in the score.
        </li>
        <li>A result with no failures does not mean a site meets WCAG 2.1 AA or any law.</li>
        <li>
          We recommend a manual review by an accessibility specialist, including testing with people who use assistive
          technology.
        </li>
      </ul>
      <div className="rp-disclaimer">
        <p>
          <strong>Disclaimer.</strong> This report identifies issues measured against WCAG 2.1 Level AA. It is not legal
          advice or a certification, and it does not state that the site complies with any law or standard, including
          the European Accessibility Act, EN 301 549 or the Americans with Disabilities Act.
        </p>
      </div>
    </section>
  );
}

export default async function ReportPage(props: PageProps<"/report/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const row = await getReportByToken(token);
  if (!row) notFound();
  const r = buildReport(row.raw);
  const print = sp.print === "1";
  const welcome = sp.welcome === "1";
  const safeHost = r.site.replace(/[^a-z0-9.-]/gi, "");
  const reportId = row.id.slice(0, 8).toUpperCase();

  return (
    <div className={`rp-root${print ? " rp-printing" : ""}`}>
      <style>{`@page { @bottom-left { content: "Legible · ${safeHost} · ${formatDate(r.scannedAt)}"; } }`}</style>
      {!print && (
        <div className="rp-toolbar" role="region" aria-label="Report actions">
          <Link href="/" className="rp-brand" aria-label="Legible, home">
            <Mark />
            <span>Legible</span>
          </Link>
          <div className="rp-actions">
            <Link href="/account">
              <span className="rp-long">Your reports</span>
              <span className="rp-short">Reports</span>
            </Link>
            <a className="btn btn-primary btn-cta" href={`/report/${token}/pdf`}>
              Download PDF
            </a>
          </div>
        </div>
      )}
      {welcome && !print && (
        <p className="rp-welcome" role="status">
          Payment received. A copy of this report, with the PDF, is on its way to {row.email}. Bookmark this page: the
          link is yours to share.
        </p>
      )}

      <main className="rp-doc" id="main">
        <section className="rp-cover" aria-labelledby="cover-title">
          <div className="rp-cover-top">
            <span className="rp-cover-brand">
              <Mark />
              Legible
            </span>
            <span className="rp-cover-id">Report {reportId}</span>
          </div>
          <div className="rp-cover-body">
            <p className="rp-cover-kicker">Accessibility report</p>
            <h1 id="cover-title">{r.site}</h1>
            <p className="rp-cover-sub">
              Measured against WCAG 2.1 Level AA · {r.pagesScanned} {r.pagesScanned === 1 ? "page" : "pages"} ·{" "}
              {formatDate(r.scannedAt)}
            </p>
            <div className="rp-cover-score">
              <span className="rp-cover-num">{r.score ?? "–"}</span>
              <span className="rp-cover-of">
                out of 100
                <br />
                {r.totalIssues} {r.totalIssues === 1 ? "failure" : "failures"} found
              </span>
            </div>
          </div>
          <p className="rp-cover-disclaimer">
            This report identifies issues measured against WCAG 2.1 Level AA. Automated testing cannot detect every
            issue, so manual review is recommended. It is not legal advice or a certification, and it does not state
            that the site complies with any law or standard.
          </p>
        </section>

        <Summary r={r} />
        <Pages r={r} />
        <Issues r={r} />
        <Review r={r} />
        <Method r={r} />
        <Limitations r={r} />
      </main>
    </div>
  );
}
