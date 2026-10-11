// Trying a fix on one element: apply it, run the same check again, undo it.
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { tryFix } from "../src/fixes/apply";

const PORT = 5081;
const base = `http://127.0.0.1:${PORT}`;
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
  // AxeBuilder needs a page from a context, as in a real scan.
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
});
afterEach(async () => {
  await context.close();
});

const leftovers = () => page.evaluate(`document.querySelectorAll('[data-legible-fix-el], [data-legible-fix]').length`);

it("passes a rule-based attribute fix and leaves the page as it was", async () => {
  await page.goto(`${base}/fixes/alt.html`);
  const v = await tryFix(page, {
    ruleId: "image-alt",
    selector: "#pic",
    html: '<img id="pic" src="/smile.png" width="40" height="40">',
    fix: { code: '<img id="pic" src="/smile.png" width="40" height="40" alt="[Describe the image]">', kind: "html" },
  });
  expect(v).toBe("pass");
  expect(await page.evaluate(`document.querySelector('#pic').hasAttribute('alt')`)).toBe(false);
  expect(await leftovers()).toBe(0);
});

it("fails a fix that does not change the result", async () => {
  await page.goto(`${base}/fixes/alt.html`);
  const v = await tryFix(page, {
    ruleId: "image-alt",
    selector: "#pic",
    html: '<img id="pic" src="/smile.png" width="40" height="40">',
    fix: { code: '<img id="pic" src="/smile.png" width="41" height="40">', kind: "html" },
  });
  expect(v).toBe("fail");
  expect(await page.evaluate(`document.querySelector('#pic').getAttribute('width')`)).toBe("40");
});

it("passes an inline colour fix and fails a stylesheet rule that loses to !important", async () => {
  await page.goto(`${base}/fixes/contrast.html`);
  expect(
    await tryFix(page, {
      ruleId: "color-contrast",
      selector: "#soft",
      html: '<p id="soft" style="color:#aaaaaa">',
      fix: { code: '<p id="soft" style="color:#595959">', kind: "html" },
    }),
  ).toBe("pass");
  expect(await page.evaluate(`document.querySelector('#soft').getAttribute('style')`)).toBe("color:#aaaaaa");
  expect(
    await tryFix(page, {
      ruleId: "color-contrast",
      selector: "#stub",
      html: '<p id="stub">',
      fix: { code: "#stub {\n  color: #595959;\n}", kind: "css" },
    }),
  ).toBe("fail");
  expect(await leftovers()).toBe(0);
});

it("tests a label added before the field, then removes it", async () => {
  await page.goto(`${base}/fixes/label.html`);
  const v = await tryFix(page, {
    ruleId: "label",
    selector: "#email",
    html: '<input id="email" type="text">',
    fix: { code: '<label for="email">[Field name]</label>\n<input id="email" type="text">', kind: "html" },
  });
  expect(v).toBe("pass");
  expect(await page.evaluate(`document.querySelectorAll('label').length`)).toBe(0);
});

it("tests a viewport fix on the meta tag", async () => {
  await page.goto(`${base}/fixes/viewport.html`);
  const v = await tryFix(page, {
    ruleId: "meta-viewport",
    selector: 'meta[name="viewport"]',
    html: '<meta name="viewport" content="width=device-width, maximum-scale=1">',
    fix: { code: '<meta name="viewport" content="width=device-width">', kind: "html" },
  });
  expect(v).toBe("pass");
  expect(await page.evaluate(`document.querySelector('meta[name="viewport"]').content`)).toBe("width=device-width, maximum-scale=1");
});

it("tests a focus outline added by CSS, and replaces an element for an AI fix", async () => {
  await page.goto(`${base}/agent/focus.html`);
  expect(
    await tryFix(page, {
      ruleId: "legible-focus-visible",
      selector: "#bad",
      html: "",
      fix: { code: "#bad:focus-visible { outline: 3px solid #000; outline-offset: 2px; }", kind: "css" },
    }),
  ).toBe("pass");
  expect(
    await tryFix(page, {
      ruleId: "legible-focus-visible",
      selector: "#bad",
      html: "",
      fix: { code: '<a id="bad" href="#x" style="outline: 3px solid #000 !important">No visible focus</a>', kind: "html" },
      replace: true,
    }),
  ).toBe("pass");
  expect(await page.evaluate(`document.querySelector('#bad').getAttribute('style')`)).toBeNull();
  expect(await leftovers()).toBe(0);
});

it("never applies what it cannot try", async () => {
  await page.goto(`${base}/agent/focus.html`);
  const base2 = { ruleId: "image-alt", selector: "#bad", html: "" };
  expect(await tryFix(page, { ...base2, fix: { code: "<b>a</b><b>b</b>", kind: "html" }, replace: true })).toBe("untestable");
  expect(await tryFix(page, { ...base2, fix: { code: "<b>" + "x".repeat(7000) + "</b>", kind: "html" }, replace: true })).toBe("untestable");
  expect(await tryFix(page, { ...base2, selector: "#nothing-here", fix: { code: "a{}", kind: "css" } })).toBe("untestable");
  expect(await tryFix(page, { ...base2, selector: "a", fix: { code: "a{}", kind: "css" } })).toBe("untestable");
  expect(await tryFix(page, { ...base2, fix: { code: "Change the menu script.", kind: "note" } })).toBe("untestable");
  expect(await tryFix(page, { ...base2, html: '<a id="bad" href="#x">', fix: { code: "<span>x</span>", kind: "html" } })).toBe("untestable");
  expect(await leftovers()).toBe(0);
});

describe("never calls a non-fix tested", () => {
  it("refuses to replace an element for a keyboard trap, since a fresh copy loses the page's own scripts", async () => {
    await page.goto(`${base}/agent/trap.html`);
    const html = (await page.evaluate(`document.querySelector('#t1').outerHTML`)) as string;
    expect(await tryFix(page, { ruleId: "legible-keyboard-trap", selector: "#t1", html, fix: { code: html, kind: "html" }, replace: true })).toBe("untestable");
  });

  it("passes focus only when the outline was measured and is visible", async () => {
    await page.goto(`${base}/agent/focus.html`);
    expect(
      await tryFix(page, { ruleId: "legible-focus-visible", selector: "#bad", html: "", fix: { code: '<a id="bad" href="#x" tabindex="-1">No visible focus</a>', kind: "html" }, replace: true }),
    ).not.toBe("pass");
    expect(await tryFix(page, { ruleId: "legible-focus-visible", selector: "#bad", html: "", fix: { code: "#bad { opacity: 0 }", kind: "css" } })).not.toBe("pass");
  });

  it("checks that an axe failure is there before calling a fix tested", async () => {
    await page.goto(`${base}/fixes/alt.html`);
    await page.evaluate(`document.querySelector('#pic').setAttribute('alt', 'A smile')`);
    expect(await tryFix(page, { ruleId: "image-alt", selector: "#pic", html: '<img id="pic">', fix: { code: "#pic { }", kind: "css" } })).toBe("unknown");
  });

  it("does not test an attribute fix that changes nothing", async () => {
    await page.goto(`${base}/fixes/alt.html`);
    const html = '<img id="pic" src="/smile.png" width="40" height="40">';
    expect(await tryFix(page, { ruleId: "image-alt", selector: "#pic", html, fix: { code: html, kind: "html" } })).toBe("untestable");
  });

  it("refuses markup it would have to change before testing, or that is not just one element of the same kind", async () => {
    await page.goto(`${base}/fixes/alt.html`);
    const t = (code: string) => tryFix(page, { ruleId: "image-alt", selector: "#pic", html: "", fix: { code, kind: "html" }, replace: true });
    expect(await t('<img id="pic" src="/smile.png" alt="Smile" onerror="alert(1)">')).toBe("untestable");
    expect(await t('<img id="pic" src=" javascript:alert(1)" alt="Smile">')).toBe("untestable");
    expect(await t('Here is the fix: <img id="pic" src="/smile.png" alt="Smile"> done')).toBe("untestable");
    expect(await t('<div><img id="pic" src="/smile.png" alt="Smile"></div>')).toBe("untestable");
    expect(await t('<span id="pic">Smile</span>')).toBe("untestable");
    expect(await leftovers()).toBe(0);
  });

  it("never applies a fix over one still on the page", async () => {
    await page.goto(`${base}/fixes/alt.html`);
    await page.evaluate(`window.__legibleUndo = [function () {}]`);
    const fix = { code: '<img id="pic" src="/smile.png" width="40" height="40" alt="[Describe the image]">', kind: "html" as const };
    expect(await tryFix(page, { ruleId: "image-alt", selector: "#pic", html: '<img id="pic" src="/smile.png" width="40" height="40">', fix })).toBe("untestable");
  });
});
