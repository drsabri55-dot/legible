// What the testing agent adds to the report. Wording awaits the owner's
// approval in the design doc.
import type { PageSummary, Report } from "@/lib/report/model";

export function ElementShot({ id, label }: { id: string | null; label: string }) {
  if (!id) return null;
  return (
    // Screenshots are served from our own route at their natural size.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="rp-shot" src={`/api/shots/${id}`} alt={`Screenshot of the element ${label}`} loading="lazy" />
  );
}

export function agentPageNote(p: PageSummary): string | null {
  if (!p.agent) return null;
  if (p.agent.status === "failed") return "The testing agent could not finish this page. Its other checks are complete.";
  if (p.agent.status === "partly") {
    if (p.agent.reason === "step limit") return "The testing agent used all its steps on this page, so it tested part of it.";
    return "The testing agent reached its time limit on this page, so it tested part of it.";
  }
  return null;
}

// The Method section describes axe-core's rules; the agent's own checks are
// counted in the score but described separately.
export function axeRuleCounts(r: Report): { passed: number; failed: number } {
  return { passed: r.rulesPassed - r.agentRules.passed, failed: r.rulesFailed - r.agentRules.failed };
}

export function agentMethod(r: Report): string | null {
  if (!r.agentUsed) return null;
  return "On each page, Legible's testing agent also used the page with the keyboard only, at 400% zoom and with wider text spacing. Keyboard traps, focus you cannot see and sideways scrolling were measured in the browser before being reported as failures. The agent uses an AI model to judge things such as image descriptions and link wording. Those judgements are listed separately and do not change the score.";
}

export function AgentReview({ r }: { r: Report }) {
  if (!r.agentReviews.length) return null;
  return (
    <section className="rp-section rp-break" aria-labelledby="agent-review">
      <p className="rp-kicker">Worth checking</p>
      <h2 id="agent-review">The agent&rsquo;s review</h2>
      <p>
        Legible&rsquo;s testing agent used each page the way a person would and flagged these as likely problems. Each
        one was checked a second time before it was included. They are the agent&rsquo;s judgement, not measured
        failures, so they are not counted in the score. Look at each one and decide.
      </p>
      {r.agentReviews.map((v, i) => (
        <article key={`${v.pageUrl}-${v.selector}-${v.kind}`} className="rp-issue" aria-labelledby={`ar-${i}`}>
          <h3 id={`ar-${i}`}>{v.title}</h3>
          <p className="rp-where">
            <span className="rp-url">{v.pageUrl}</span> <code>{v.selector}</code>
          </p>
          <p>{v.reason}</p>
          <ElementShot id={v.shot} label={v.selector} />
          <pre>
            <code>{v.html}</code>
          </pre>
        </article>
      ))}
    </section>
  );
}
