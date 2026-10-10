import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { guardPage } from "../src/agent/guard";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5071;
const base = `http://127.0.0.1:${PORT}`;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

it("never lets the page submit a form or leave the site, and can be removed", async () => {
  const page = await (await getBrowser()).newPage();
  await page.goto(`${base}/agent/post.html`);
  const release = await guardPage(page);
  await page.focus("#send");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await page.focus("#away");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await page.evaluate("alert('hi')"); // dismissed, does not hang
  expect(new URL(page.url()).pathname).toBe("/agent/post.html");
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  expect(await (await fetch(`${base}/__posts`)).text()).toBe("0");
  await release();
  await page.close();
});
