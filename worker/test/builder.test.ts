import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { BUILDER_PROBE } from "../src/builder";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => browser.close());

const probe = async (html: string) => {
  const page = await browser.newPage();
  // Scripts are not fetched: only their addresses matter here.
  await page.route("**/*", (route) => route.abort());
  await page.setContent(html);
  const out = await page.evaluate(BUILDER_PROBE);
  await page.close();
  return out;
};

it("recognises the common website builders from the page's code", async () => {
  expect(await probe('<meta name="generator" content="WordPress 6.6"><p>x</p>')).toBe("WordPress");
  expect(await probe('<link rel="stylesheet" href="https://example.com/wp-content/themes/a/style.css">')).toBe("WordPress");
  expect(await probe('<script src="https://cdn.shopify.com/s/files/x.js"></script>')).toBe("Shopify");
  expect(await probe('<meta name="generator" content="Wix.com Website Builder">')).toBe("Wix");
  expect(await probe('<link rel="stylesheet" href="https://static1.squarespace.com/static/x.css">')).toBe("Squarespace");
  expect(await probe('<html data-wf-site="abc"><body>x</body></html>')).toBe("Webflow");
  expect(await probe("<p>Hand-made</p>")).toBeNull();
});
