import type { Server } from "node:http";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { runAgentOnPage } from "../src/agent/run";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5074;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

async function open(name: string): Promise<Page> {
  const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/agent/${name}.html`);
  return page;
}

describe("runAgentOnPage", () => {
  it("turns measurements into failures, hand checks and passes", async () => {
    const page = await open("focus");
    const shots: string[] = [];
    const out = await runAgentOnPage(page, { model: new ReplayModel([{ calls: [{ name: "done", input: { summary: "ok" } }] }]), onShot: (id) => void shots.push(id) });
    expect(out.violations.map((v) => v.id)).toEqual(["legible-focus-visible"]);
    expect(out.violations[0]).toMatchObject({ impact: "serious", tags: ["wcag2aa", "wcag247"], nodeCount: 1 });
    expect(out.violations[0].nodes[0].shot).toBe(shots[0]);
    expect(out.passes.map((p) => p.id).sort()).toEqual(["legible-keyboard-trap", "legible-reflow"]);
    expect(out.result).toMatchObject({ status: "tested", steps: 1 });
    await page.close();
  });

  it("keeps a judgement only when the second pass agrees", async () => {
    const page = await open("alt");
    const model = new ReplayModel([
      { calls: [{ name: "judge", input: { kind: "image-description", selector: "#photo", reason: "File name as alt." } }, { name: "judge", input: { kind: "link-purpose", selector: "#more", reason: "Click here." } }] },
      { calls: [{ name: "done", input: { summary: "ok" } }] },
      { calls: [{ name: "verdict", input: { problem: true, reason: "The alt text is a file name." } }] },
      { calls: [{ name: "verdict", input: { problem: false, reason: "Clear enough in context." } }] },
    ]);
    const out = await runAgentOnPage(page, { model });
    expect(out.result.reviews.map((r) => [r.kind, r.selector])).toEqual([["image-description", "#photo"]]);
    expect(out.result.usage.inputTokens).toBe(400); // 4 model calls of 100
    await page.close();
  });

  it("measures a claim, and drops it when the measurement disagrees", async () => {
    const page = await open("clean");
    const model = new ReplayModel([
      { calls: [{ name: "claim", input: { kind: "keyboard-trap", selector: "#name", note: "stuck" } }] },
      { calls: [{ name: "claim", input: { kind: "focus-visible", selector: "#does-not-exist", note: "?" } }] },
      { calls: [{ name: "done", input: { summary: "ok" } }] },
    ]);
    const out = await runAgentOnPage(page, { model });
    expect(out.violations).toEqual([]);
    expect(out.incomplete).toEqual([]);
    const toolResults = JSON.stringify(model.requests[1].messages.at(-1));
    expect(toolResults).toContain("not reported");
    await page.close();
  });

  it("refuses unknown tools and bad input without crashing", async () => {
    const page = await open("clean");
    const model = new ReplayModel([
      { calls: [{ name: "click", input: { x: 1 } }, { name: "press", input: { key: "F12" } }] },
      { calls: [{ name: "done", input: { summary: "ok" } }] },
    ]);
    const out = await runAgentOnPage(page, { model });
    expect(out.result).toMatchObject({ status: "tested", steps: 3 });
    expect(JSON.stringify(model.requests[1].messages.at(-1))).toContain('"is_error":true');
    await page.close();
  });

  it("stops at the step limit, keeps measurements, and marks the page partly tested", async () => {
    const page = await open("reflow");
    const press = { calls: [{ name: "press", input: { key: "Tab" } }] };
    const out = await runAgentOnPage(page, { model: new ReplayModel([press, press, press, press]), maxSteps: 3 });
    expect(out.result).toMatchObject({ status: "partly", reason: "step limit", steps: 3 });
    expect(out.violations.map((v) => v.id)).toEqual(["legible-reflow"]);
    await page.close();
  });

  it("survives a model error and a refusal", async () => {
    let page = await open("trap");
    let out = await runAgentOnPage(page, { model: new ReplayModel([{ error: "overloaded" }]) });
    expect(out.result).toMatchObject({ status: "failed", reason: "model error" });
    expect(out.violations.map((v) => v.id)).toEqual(["legible-keyboard-trap"]); // measured anyway
    await page.close();
    page = await open("clean");
    out = await runAgentOnPage(page, { model: new ReplayModel([{ refuse: true }]) });
    expect(out.result).toMatchObject({ status: "failed", reason: "declined" });
    await page.close();
  });

  it("restores the window and the guard afterwards", async () => {
    const page = await open("clean");
    await runAgentOnPage(page, { model: new ReplayModel([{ calls: [{ name: "zoom", input: { on: true } }] }, { calls: [{ name: "done", input: { summary: "ok" } }] }]) });
    expect(page.viewportSize()).toEqual({ width: 1280, height: 900 });
    expect(await page.evaluate("!!document.getElementById('legible-text-spacing')")).toBe(false);
    await page.close();
  });
});

describe("runAgentOnPage when something breaks", () => {
  it("keeps findings without their screenshot when storing it fails", async () => {
    const page = await open("focus");
    const out = await runAgentOnPage(page, {
      model: new ReplayModel([{ calls: [{ name: "done", input: { summary: "ok" } }] }]),
      onShot: () => {
        throw new Error("storage down");
      },
    });
    expect(out.result.status).toBe("tested");
    expect(out.violations.map((v) => v.id)).toEqual(["legible-focus-visible"]);
    expect(out.violations[0].nodes[0].shot).toBeUndefined();
    await page.close();
  });

  it("returns what it measured, marked failed, when the page breaks mid-run", async () => {
    const page = await open("reflow");
    const breaking = {
      name: "breaking",
      turn: async () => {
        await page.evaluate("document.documentElement.innerHTML = ''");
        await page.close();
        return { content: [{ type: "tool_use", id: "t1", name: "press", input: { key: "Tab" } }] as never, stopReason: "tool_use", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      },
    };
    const out = await runAgentOnPage(page, { model: breaking });
    expect(out.result).toMatchObject({ status: "failed", reason: "agent error" });
    expect(out.violations.map((v) => v.id)).toEqual(["legible-reflow"]);
  });
});

describe("runAgentOnPage and other pages", () => {
  it("is back on the page under test before the second opinions", async () => {
    const page = await open("nav");
    const wanderer = {
      name: "wanderer",
      turn: async () => {
        await page.goto(`http://127.0.0.1:${PORT}/agent/clean.html`);
        return { content: [{ type: "tool_use", id: "t1", name: "done", input: { summary: "ok" } }] as never, stopReason: "tool_use", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
      },
    };
    await runAgentOnPage(page, { model: wanderer });
    expect(new URL(page.url()).pathname).toBe("/agent/nav.html");
    await page.close();
  });
});

describe("runAgentOnPage time budget", () => {
  it("stops measuring and asking at its budget, and says so", async () => {
    const page = await open("long");
    const model = new ReplayModel([{ calls: [{ name: "press", input: { key: "Tab" } }] }]);
    const started = Date.now();
    const out = await runAgentOnPage(page, { model, budgetMs: 300 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(out.result).toMatchObject({ status: "partly", reason: "time limit" });
    expect(model.requests.length).toBe(0);
    await page.close();
  });

  it("gives every model call a deadline inside the budget", async () => {
    const page = await open("clean");
    const model = new ReplayModel([{ calls: [{ name: "done", input: { summary: "ok" } }] }]);
    const started = Date.now();
    await runAgentOnPage(page, { model, loopMs: 20_000 });
    expect(model.requests[0].deadline).toBeGreaterThan(started);
    expect(model.requests[0].deadline!).toBeLessThanOrEqual(Date.now() + 20_000);
    await page.close();
  });
});

