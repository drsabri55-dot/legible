import type { Server } from "node:http";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { keyboardWalk, measureFocusAt, trapFrom } from "../src/agent/measure";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5069;
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

describe("keyboardWalk", () => {
  it("finds nothing on a clean page and reaches every control", async () => {
    const page = await open("clean");
    const { reached, findings } = await keyboardWalk(page);
    expect(findings).toEqual([]);
    expect(reached.length).toBe(5); // One, Two, the field, Save, the back link
    await page.close();
  });

  it("proves a keyboard trap", async () => {
    const page = await open("trap");
    const { findings } = await keyboardWalk(page);
    const trap = findings.find((f) => f.kind === "keyboard-trap");
    expect(trap).toMatchObject({ verdict: "fail" });
    expect(trap!.selector).toMatch(/#t[123]/);
    await page.close();
  });

  it("does not call a long page a trap", async () => {
    const page = await open("long");
    const { findings } = await keyboardWalk(page);
    expect(findings.filter((f) => f.kind === "keyboard-trap")).toEqual([]);
    await page.close();
  });

  it("fails focus that cannot be seen, and accepts focus shown on the element or its card", async () => {
    const page = await open("focus");
    const { findings } = await keyboardWalk(page);
    const focus = findings.filter((f) => f.kind === "focus-visible");
    expect(focus.map((f) => [f.selector, f.verdict])).toEqual([["#bad", "fail"]]);
    expect(focus[0].shot?.length).toBeGreaterThan(100);
    await page.close();
  });
});

describe("targeted measurements", () => {
  it("measures one element's focus and one trap on request", async () => {
    let page = await open("focus");
    expect(await measureFocusAt(page, "#bad")).toMatchObject({ kind: "focus-visible", verdict: "fail" });
    expect(await measureFocusAt(page, "#good")).toBeNull();
    expect(await measureFocusAt(page, "#missing")).toBeNull();
    await page.close();
    page = await open("trap");
    expect(await trapFrom(page, "#t2")).toMatchObject({ kind: "keyboard-trap", verdict: "fail" });
    await page.close();
    page = await open("clean");
    expect(await trapFrom(page, "#name")).toBeNull();
    await page.close();
  });
});
