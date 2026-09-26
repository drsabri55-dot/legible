import type { Issue } from "@/lib/report/model";
import { understandingUrl } from "@/lib/rules/wcag";
import { ImpactTag } from "./ImpactTag";

function Code({ label, code, tone }: { label: string; code: string; tone: "bad" | "good" }) {
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-[6px] text-[12px] uppercase tracking-[0.16em] text-nc-neutral-400">{label}</figcaption>
      <pre
        className="m-0 overflow-x-auto rounded-[8px] border p-[12px] text-[12.5px] leading-[1.6] whitespace-pre-wrap break-words"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          background: "#0e0f18",
          borderColor: tone === "bad" ? "color-mix(in srgb, var(--color-critical) 30%, transparent)" : "color-mix(in srgb, var(--color-accent-400) 35%, transparent)",
          color: "var(--color-neutral-200)",
        }}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}

// One issue in full, on the dark site theme (the free sample on the result page).
export function IssueDetail({ issue, headingLevel = 3 }: { issue: Issue; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const example = issue.examples[0];
  return (
    <article className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-[clamp(18px,3vw,28px)]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <ImpactTag impact={issue.impact} />
        <span className="text-[12px] text-nc-neutral-400">
          {issue.instances} {issue.instances === 1 ? "element" : "elements"} on {issue.pages.length}{" "}
          {issue.pages.length === 1 ? "page" : "pages"}
        </span>
      </div>
      <H className="mt-[14px] mb-0 text-[clamp(19px,1.8vw,23px)] leading-[1.25] tracking-[-0.015em] text-nc-neutral-100">
        {issue.title}
      </H>
      <p className="mt-[10px] mb-0 text-[14.5px] leading-[1.75] text-nc-neutral-300">{issue.summary}</p>
      <dl className="mt-[18px] grid gap-x-6 gap-y-[14px] text-[14px] leading-[1.7] sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="text-[12px] uppercase tracking-[0.16em] text-nc-neutral-400 sm:pt-[3px]">Why it matters</dt>
        <dd className="m-0 text-nc-neutral-200">{issue.why}</dd>
        <dt className="text-[12px] uppercase tracking-[0.16em] text-nc-neutral-400 sm:pt-[3px]">Who it affects</dt>
        <dd className="m-0 text-nc-neutral-200">{issue.who}</dd>
        <dt className="text-[12px] uppercase tracking-[0.16em] text-nc-neutral-400 sm:pt-[3px]">How to fix it</dt>
        <dd className="m-0 text-nc-neutral-200">{issue.fix}</dd>
        <dt className="text-[12px] uppercase tracking-[0.16em] text-nc-neutral-400 sm:pt-[3px]">WCAG 2.1</dt>
        <dd className="m-0 text-nc-neutral-200">
          {issue.criteria.length
            ? issue.criteria.map((c, i) => (
                <span key={c.sc}>
                  {i > 0 && ", "}
                  <a href={understandingUrl(c.sc)} target="_blank" rel="noreferrer">
                    {c.sc} {c.name}
                  </a>{" "}
                  (Level {c.level})
                </span>
              ))
            : "Related to WCAG 2.1 Level A/AA"}
        </dd>
      </dl>
      {example && example.fixed && (
        <div className="mt-[22px] grid gap-[14px] md:grid-cols-2">
          <Code label="Your code" code={example.html} tone="bad" />
          <Code label="Corrected" code={example.fixed} tone="good" />
        </div>
      )}
      {example && !example.fixed && (
        <>
          <div className="mt-[22px]">
            <Code
              label={example.embeddedFrom ? `Code from ${example.embeddedFrom}` : "Your code"}
              code={example.html}
              tone="bad"
            />
          </div>
          {issue.genericBefore && !example.embeddedFrom && (
            <div className="mt-[14px] grid gap-[14px] md:grid-cols-2">
              <Code label="General example: before" code={issue.genericBefore} tone="bad" />
              <Code label="General example: after" code={issue.genericAfter} tone="good" />
            </div>
          )}
        </>
      )}
      {example?.note && <p className="mt-[12px] mb-0 text-[13px] leading-[1.7] text-nc-neutral-400">{example.note}</p>}
      {example && (
        <p className="mt-[10px] mb-0 text-[12px] text-nc-neutral-500 break-all">
          Found on {example.pageUrl}
          {example.alsoOn > 0 && ` and ${example.alsoOn} other ${example.alsoOn === 1 ? "page" : "pages"}`} at{" "}
          <code className="text-nc-neutral-400">{example.selector}</code>
        </p>
      )}
    </article>
  );
}
