import { describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue";

describe("JobQueue", () => {
  it("never runs more than the limit at once and refuses when full", async () => {
    const q = new JobQueue(2, 2);
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    const job = (n: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
      done.push(n);
    };
    expect(q.push(job(1))).toBe(true);
    expect(q.push(job(2))).toBe(true);
    expect(q.push(job(3))).toBe(true);
    expect(q.push(job(4))).toBe(true);
    expect(q.push(job(5))).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4]);
  });
});
