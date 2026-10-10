import type { Server } from "node:http";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { changedShare, elementInfoScript, focusInfoScript, type FocusInfo } from "../src/agent/dom";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5068;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

function png(w: number, h: number, paint: (x: number, y: number) => number): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = paint(x, y);
      p.data[i] = p.data[i + 1] = p.data[i + 2] = v;
      p.data[i + 3] = 255;
    }
  return PNG.sync.write(p);
}

describe("changedShare", () => {
  it("is 0 for the same picture and counts clearly changed pixels", () => {
    const a = png(10, 10, () => 255);
    expect(changedShare(a, a)).toBe(0);
    const b = png(10, 10, (x) => (x === 0 ? 0 : 255));
    expect(changedShare(a, b)).toBeCloseTo(0.1);
    // Tiny shifts (anti-aliasing, JPEG noise) are not changes.
    expect(changedShare(a, png(10, 10, () => 240))).toBe(0);
  });
  it("treats different sizes as fully changed", () => {
    expect(changedShare(png(2, 2, () => 0), png(3, 3, () => 0))).toBe(1);
  });
});

describe("in-page helpers", () => {
  it("describes the focused element with a unique selector", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/agent/clean.html`);
    await page.keyboard.press("Tab");
    const info = (await page.evaluate(focusInfoScript())) as FocusInfo;
    expect(info).toMatchObject({ tag: "a", name: "One" });
    expect(await page.locator(info!.selector).count()).toBe(1);
    const el = (await page.evaluate(elementInfoScript("#name"))) as { html: string; text: string } | null;
    expect(el?.html).toContain('id="name"');
    expect(await page.evaluate(elementInfoScript("#nothing-here"))).toBeNull();
    await page.close();
  });
});
