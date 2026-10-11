import { describe, expect, it } from "vitest";
import { buildFixPlan, planIntro, planTime, stepLine } from "@/lib/report/plan";
import type { Issue } from "@/lib/report/model";

const issue = (ruleId: string, over: Partial<Issue> = {}): Issue =>
  ({
    ruleId,
    title: ruleId,
    impact: "serious",
    effort: "quick",
    doer: "developer",
    instances: 1,
    embeddedFrom: null,
    ...over,
  }) as Issue;

describe("the fix order plan", () => {
  const issues = [
    issue("b-moderate-involved", { impact: "moderate", effort: "involved" }),
    issue("a-critical-moderate", { impact: "critical", effort: "moderate", doer: "you" }),
    issue("c-critical-quick", { impact: "critical", effort: "quick", instances: 2 }),
    issue("d-critical-quick-more", { impact: "critical", effort: "quick", instances: 9 }),
    issue("e-serious-quick", { impact: "serious", effort: "quick", doer: "you" }),
    issue("f-embedded", { impact: "critical", embeddedFrom: "youtube.com" }),
  ];

  it("puts what stops people first, and quick fixes first within each level", () => {
    const plan = buildFixPlan(issues);
    expect(plan.steps.map((s) => s.ruleId)).toEqual([
      "d-critical-quick-more",
      "c-critical-quick",
      "a-critical-moderate",
      "e-serious-quick",
      "b-moderate-involved",
    ]);
    expect(plan.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves out content embedded from other sites, and counts it", () => {
    expect(buildFixPlan(issues).embedded).toBe(1);
  });

  it("adds up the time as a range and says who can do what", () => {
    const plan = buildFixPlan(issues);
    // 3 quick (30), 1 moderate (60-120), 1 involved (180-240)
    expect(plan.minutes).toEqual([270, 390]);
    expect(plan.you).toBe(2);
    expect(plan.developer).toBe(3);
  });

  it("gives the same plan whatever order the problems arrive in", () => {
    expect(buildFixPlan([...issues].reverse())).toEqual(buildFixPlan(issues));
  });

  it("says the time in plain words", () => {
    expect(planTime([10, 10])).toBe("about 10 minutes");
    expect(planTime([30, 30])).toBe("about 30 minutes");
    expect(planTime([60, 120])).toBe("about 1 to 2 hours");
    expect(planTime([70, 130])).toBe("about 1 to 2 hours");
    expect(planTime([180, 240])).toBe("about 3 to 4 hours");
    expect(planTime([60, 60])).toBe("about 1 hour");
    expect(planTime([270, 390])).toBe("about 5 to 7 hours");
  });

  it("introduces the plan and each step", () => {
    const plan = buildFixPlan(issues);
    expect(planIntro(plan)).toBe("5 steps, about 5 to 7 hours in total. 2 you can do yourself, 3 need a developer.");
    expect(planIntro(buildFixPlan([issue("x", { doer: "you" })]))).toBe("1 step, about 10 minutes in total. 1 you can do yourself.");
    expect(planIntro(buildFixPlan([issue("x")]))).toBe("1 step, about 10 minutes in total. 1 needs a developer.");
    expect(stepLine(plan.steps[0])).toBe("9 places, about 10 minutes. Needs a developer.");
    expect(stepLine(plan.steps[3])).toBe("1 place, about 10 minutes. You can do this yourself.");
  });
});

describe("the report's plan", () => {
  it("is built with the report", async () => {
    const { buildReport } = await import("@/lib/report/model");
    const { sampleScan } = await import("./fixture");
    const r = buildReport(sampleScan());
    expect(r.plan.steps.map((s) => s.ruleId)).toEqual(buildFixPlan(r.issues).steps.map((s) => s.ruleId));
    expect(r.plan.steps.length).toBe(r.issues.length);
  });
});
