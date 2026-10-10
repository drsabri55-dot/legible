// The worker and the site share one scan contract, kept in two files.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const part = (file: string) => {
  const text = readFileSync(file, "utf8");
  return text.slice(text.indexOf("export interface RawNode"));
};

describe("scan contract", () => {
  it("is identical in the worker and the site", () => {
    expect(part("src/types/scan.ts")).toBe(part("worker/src/types.ts"));
  });

  it("carries the agent's results", () => {
    const text = part("src/types/scan.ts");
    for (const name of ["AgentUsage", "AgentReview", "AgentReviewKind", "AgentPageResult", "shot?: string", "agent?: AgentPageResult"]) {
      expect(text).toContain(name);
    }
  });
});
