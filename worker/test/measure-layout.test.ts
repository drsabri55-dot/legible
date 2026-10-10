import type { Server } from "node:http";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { measureKeyboardReach, measureReflow, measureTextSpacing } from "../src/agent/measure";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5070;
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

describe("layout measurements", () => {
  it("fails sideways scrolling at 400% and restores the window", async () => {
    const page = await open("reflow");
    const found = await measureReflow(page);
    expect(found).toMatchObject([{ kind: "reflow", verdict: "fail", selector: "#wide" }]);
    expect(page.viewportSize()).toEqual({ width: 1280, height: 900 });
    await page.close();
  });

  it("sends a wide data table for a hand check, not a failure", async () => {
    const page = await open("table");
    expect(await measureReflow(page)).toMatchObject([{ kind: "reflow", verdict: "review" }]);
    await page.close();
  });

  it("flags text cut off by wider spacing, and removes the spacing after", async () => {
    const page = await open("spacing");
    expect(await measureTextSpacing(page)).toMatchObject([{ kind: "text-spacing", verdict: "review", selector: "#tight" }]);
    expect(await page.evaluate("!!document.getElementById('legible-text-spacing')")).toBe(false);
    await page.close();
  });

  it("flags a clickable element the keyboard never reaches", async () => {
    const page = await open("reach");
    expect(await measureKeyboardReach(page, ["body > a:nth-of-type(1)"])).toMatchObject([
      { kind: "keyboard-reach", verdict: "review", selector: "#fake" },
    ]);
    await page.close();
  });

  it("finds nothing on the clean page", async () => {
    const page = await open("clean");
    expect([...(await measureReflow(page)), ...(await measureTextSpacing(page)), ...(await measureKeyboardReach(page, []))]).toEqual([]);
    await page.close();
  });
});
