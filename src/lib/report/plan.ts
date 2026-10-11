// The fix order plan: what to fix first, how long it takes and who can do
// it. Worked out by fixed rules, so the same results always give the same plan.
import { IMPACT_ORDER, type Doer, type Effort, type Impact } from "../rules/catalogue";
import type { Issue } from "./model";

// Time for one problem group: quick about 10 minutes, moderate about 1 to 2
// hours, involved about half a day.
export const EFFORT_MINUTES: Record<Effort, [number, number]> = {
  quick: [10, 10],
  moderate: [60, 120],
  involved: [180, 240],
};
const EFFORT_ORDER: Effort[] = ["quick", "moderate", "involved"];

export interface PlanStep {
  n: number;
  ruleId: string;
  title: string;
  places: number;
  impact: Impact;
  effort: Effort;
  doer: Doer;
  minutes: [number, number];
}

export interface FixPlan {
  steps: PlanStep[];
  minutes: [number, number];
  you: number;
  developer: number;
  // Problems wholly in content embedded from other sites: not the owner's to fix.
  embedded: number;
}

export function buildFixPlan(issues: Issue[]): FixPlan {
  const own = issues.filter((i) => !i.embeddedFrom);
  const ordered = [...own].sort(
    (a, b) =>
      IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) ||
      EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort) ||
      b.instances - a.instances ||
      a.title.localeCompare(b.title) ||
      a.ruleId.localeCompare(b.ruleId),
  );
  const steps = ordered.map((i, k) => ({
    n: k + 1,
    ruleId: i.ruleId,
    title: i.title,
    places: i.instances,
    impact: i.impact,
    effort: i.effort,
    doer: i.doer,
    minutes: EFFORT_MINUTES[i.effort],
  }));
  return {
    steps,
    minutes: steps.reduce<[number, number]>((t, s) => [t[0] + s.minutes[0], t[1] + s.minutes[1]], [0, 0]),
    you: steps.filter((s) => s.doer === "you").length,
    developer: steps.filter((s) => s.doer === "developer").length,
    embedded: issues.length - own.length,
  };
}

export function planTime([low, high]: [number, number]): string {
  if (high < 60) return `about ${high} minutes`;
  const lo = Math.max(1, Math.round(low / 60));
  const hi = Math.max(lo, Math.round(high / 60));
  return lo === hi ? `about ${lo} ${lo === 1 ? "hour" : "hours"}` : `about ${lo} to ${hi} hours`;
}

export function planIntro(plan: FixPlan): string {
  const n = plan.steps.length;
  const who = [
    plan.you ? `${plan.you} you can do yourself` : "",
    plan.developer ? `${plan.developer} ${plan.developer === 1 ? "needs" : "need"} a developer` : "",
  ].filter(Boolean);
  return `${n} ${n === 1 ? "step" : "steps"}, ${planTime(plan.minutes)} in total. ${who.join(", ")}.`;
}

export function stepLine(step: PlanStep): string {
  const who = step.doer === "you" ? "You can do this yourself." : "Needs a developer.";
  return `${step.places} ${step.places === 1 ? "place" : "places"}, ${planTime(step.minutes)}. ${who}`;
}
