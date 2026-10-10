import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { AGENT_TOOLS, pageOutlineScript, perform, type ActionState } from "../src/agent/actions";
import { SYSTEM_PROMPT, firstMessage } from "../src/agent/prompts";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5072;
const base = `http://127.0.0.1:${PORT}`;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

describe("actions", () => {
  it("presses keys and reports where focus is, with a screenshot", async () => {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    const r = await perform(page, "press", { key: "Tab" }, state);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Focus: a");
    expect(r.text).toContain('"One"');
    expect(r.image?.length).toBeGreaterThan(1000);
    await page.close();
  });

  it("types only from the fixed list, and only into a field", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    expect((await perform(page, "type", { text: "Test name" }, state)).ok).toBe(false); // nothing focused
    await page.focus("#name");
    expect((await perform(page, "type", { text: "my real password" }, state)).ok).toBe(false);
    expect((await perform(page, "type", { text: "Test name" }, state)).ok).toBe(true);
    expect(await page.inputValue("#name")).toBe("Test name");
    await page.close();
  });

  it("zooms and spaces text, then puts both back", async () => {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    await perform(page, "zoom", { on: true }, state);
    expect(page.viewportSize()?.width).toBe(320);
    await perform(page, "spacing", { on: true }, state);
    expect(await page.evaluate("!!document.getElementById('legible-text-spacing')")).toBe(true);
    await perform(page, "zoom", { on: false }, state);
    await perform(page, "spacing", { on: false }, state);
    expect(page.viewportSize()?.width).toBe(1280);
    expect(state).toMatchObject({ zoomed: false, spaced: false });
    await page.close();
  });

  it("comes back when Enter opens another page of the site", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/nav.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    await page.focus("#go");
    const r = await perform(page, "press", { key: "Enter" }, state);
    expect(r.text).toContain("returned to the page under test");
    expect(new URL(page.url()).pathname).toBe("/agent/nav.html");
    await page.close();
  });

  it("refuses unknown actions and bad values", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    expect((await perform(page, "click", {}, state)).ok).toBe(false);
    expect((await perform(page, "press", { key: "F5" }, state)).ok).toBe(false);
    await page.close();
  });

  it("outlines the page with selectors", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/alt.html`);
    const outline = (await page.evaluate(pageOutlineScript())) as string;
    expect(outline).toContain('#photo | img | alt="image123"');
    expect(outline).toContain('#more | link | "Click here"');
    expect(outline).toContain("h1");
    await page.close();
  });
});

describe("tools and prompts", () => {
  it("defines strict schemas for every tool", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(["press", "type", "zoom", "spacing", "look", "claim", "judge", "done"]);
    for (const t of AGENT_TOOLS) expect(t.input_schema).toMatchObject({ type: "object", additionalProperties: false });
  });
  it("tells the model the rules and sends the page as an image", () => {
    expect(SYSTEM_PROMPT).toContain("keyboard");
    expect(SYSTEM_PROMPT).not.toMatch(/compliant|legally safe/i);
    const m = firstMessage("https://a.example/", ["focus-visible: #x (fail)"], "#x | link | \"Go\"", Buffer.from("jpeg"));
    expect(JSON.stringify(m)).toContain("https://a.example/");
    expect((m.content as { type: string }[]).some((b) => b.type === "image")).toBe(true);
  });
});
