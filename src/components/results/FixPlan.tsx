import { builderNote } from "@/components/report/FixLabels";
import { planIntro, stepLine, type FixPlan as Plan } from "@/lib/report/plan";

// The fix order plan on the free result: numbered steps, each linking to its
// problem further down the page.
export function FixPlan({ plan, builtWith }: { plan: Plan; builtWith: string | null }) {
  if (!plan.steps.length) return null;
  return (
    <section aria-labelledby="plan" className="mt-16">
      <h2 id="plan" className="m-0 text-[clamp(24px,2.6vw,32px)] leading-[1.2] tracking-[-0.02em]">
        Your fix plan
      </h2>
      <p className="mt-3 max-w-[56ch] text-[15px] leading-[1.8] text-nc-neutral-300">{planIntro(plan)}</p>
      {builtWith && <p className="mt-2 max-w-[56ch] text-[14px] leading-[1.8] text-nc-neutral-400">{builderNote(builtWith)}</p>}
      <ol className="mt-6 mb-0 list-none space-y-0 p-0">
        {plan.steps.map((s) => (
          <li key={s.ruleId} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2 border-t border-white/[0.07] py-[12px]">
            <span aria-hidden="true" className="text-[15px] tabular-nums text-nc-accent-300">
              {s.n}
            </span>
            <span className="min-w-0">
              <a href={`#issue-${s.ruleId}`} className="inline-flex min-h-[24px] items-center text-[15px] text-nc-neutral-100">
                {s.title}
              </a>
              <span className="block text-[13.5px] leading-[1.7] text-nc-neutral-400">{stepLine(s)}</span>
            </span>
          </li>
        ))}
      </ol>
      {plan.embedded > 0 && (
        <p className="mt-4 mb-0 max-w-[56ch] text-[13.5px] leading-[1.7] text-nc-neutral-400">
          {plan.embedded} more {plan.embedded === 1 ? "problem is" : "problems are"} in content embedded from other sites,
          so {plan.embedded === 1 ? "it is" : "they are"} left out of the plan. You will find {plan.embedded === 1 ? "it" : "them"} below.
        </p>
      )}
    </section>
  );
}
