// The model writes a fix where no rule-based fix works. Every fix it writes
// is tried in the browser first; one that fails twice is never kept.
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { writeFix } from "../src/fixes/ai";

const PORT = 5083;
let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
beforeAll(async () => {
  server = await serveFixture(PORT);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  server.close();
});
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/agent/focus.html`);
});
afterEach(async () => {
  await context.close();
});

const failure = { ruleId: "legible-focus-visible", help: "You cannot see where keyboard focus is", summary: "Nothing on screen changes when this link receives focus.", selector: "#bad" };
const answer = (kind: string, code: string, note = "Adds a visible outline.") => ({ calls: [{ name: "fix", input: { kind, code, note } }] });
const OUTLINE = "#bad:focus-visible { outline: 3px solid #000; outline-offset: 2px; }";
const NOTHING = "#bad { color: inherit; }";

it("keeps a fix that passes the same check, marked tested", async () => {
  const model = new ReplayModel([answer("css", OUTLINE)]);
  const fix = await writeFix(model, page, failure, Date.now() + 60_000);
  expect(fix).toEqual({ code: OUTLINE, kind: "css", status: "tested", source: "ai", note: "Adds a visible outline." });
  // It saw the element's code and styles.
  expect(JSON.stringify(model.requests[0].messages)).toContain('id=\\"bad\\"');
  expect(JSON.stringify(model.requests[0].messages)).toContain("outline");
});

it("gives the model one more try when its first fix fails", async () => {
  const model = new ReplayModel([answer("css", NOTHING), answer("css", OUTLINE)]);
  const fix = await writeFix(model, page, failure, Date.now() + 60_000);
  expect(fix).toMatchObject({ code: OUTLINE, status: "tested" });
  expect(model.requests).toHaveLength(2);
  expect(JSON.stringify(model.requests[1].messages)).toContain("still fails");
});

it("keeps nothing when both tries fail", async () => {
  const model = new ReplayModel([answer("css", NOTHING), answer("css", NOTHING)]);
  expect(await writeFix(model, page, failure, Date.now() + 60_000)).toBeNull();
});

it("shows a change it cannot try as not tested", async () => {
  const model = new ReplayModel([answer("note", "In the menu script, stop removing the outline on focus.", "This is set in a script.")]);
  expect(await writeFix(model, page, failure, Date.now() + 60_000)).toMatchObject({ kind: "note", status: "untested", source: "ai" });
});

it("keeps nothing without a usable answer", async () => {
  expect(await writeFix(new ReplayModel([{ text: "I would add an outline." }]), page, failure, Date.now() + 60_000)).toBeNull();
  expect(await writeFix(new ReplayModel([{ error: "overloaded" }]), page, failure, Date.now() + 60_000)).toBeNull();
  expect(await writeFix(new ReplayModel([answer("css", "x".repeat(7000))]), page, failure, Date.now() + 60_000)).toBeNull();
  expect(await writeFix(new ReplayModel([answer("css", OUTLINE)]), page, failure, Date.now() - 1)).toBeNull();
});
