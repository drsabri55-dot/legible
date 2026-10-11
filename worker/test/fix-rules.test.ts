// Each failing element's rule-based fix is tried in the browser before the
// report may call it tested.
import type { Server } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { testRuleFixes } from "../src/fixes/rules";
import { toRawPage } from "../src/scan";

const PORT = 5082;
let server: Server;
let browser: Browser;
beforeAll(async () => {
  server = await serveFixture(PORT);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
  server.close();
});

async function scanned(path: string, rules: string[]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}${path}`);
  const axe = await new AxeBuilder({ page }).options({ runOnly: { type: "rule", values: rules } }).analyze();
  return { context, page, raw: toRawPage(page.url(), "t", axe) };
}

it("marks working fixes tested and hands back the ones that fail", async () => {
  const { context, page, raw } = await scanned("/fixes/contrast.html", ["color-contrast"]);
  const failed = await testRuleFixes(page, raw.violations, Date.now() + 20_000);
  const nodes = raw.violations[0].nodes;
  const soft = nodes.find((n) => n.target[0] === "#soft")!;
  const stub = nodes.find((n) => n.target[0] === "#stub")!;
  expect(soft.fix).toMatchObject({ kind: "html", status: "tested", source: "rule" });
  expect(soft.fix!.code).toContain("color:");
  expect(stub.fix).toBeUndefined();
  expect(failed).toEqual([stub]);
  await context.close();
});

it("tests an added alt text, and skips agent rules and frames", async () => {
  const { context, page, raw } = await scanned("/fixes/alt.html", ["image-alt"]);
  raw.violations.push({ id: "legible-reflow", impact: "serious", help: "", description: "", helpUrl: "", tags: [], nodeCount: 1, nodes: [{ html: "<div>", target: ["#wide"] }] });
  raw.violations[0].nodes.push({ html: '<img src="x">', target: ["iframe", "img"] });
  const failed = await testRuleFixes(page, raw.violations, Date.now() + 20_000);
  expect(raw.violations[0].nodes[0].fix).toMatchObject({ status: "tested", source: "rule" });
  expect(raw.violations[0].nodes[1].fix).toBeUndefined();
  expect(raw.violations[1].nodes[0].fix).toBeUndefined();
  expect(failed).toEqual([]);
  await context.close();
});

it("stops at its deadline", async () => {
  const { context, page, raw } = await scanned("/fixes/alt.html", ["image-alt"]);
  await testRuleFixes(page, raw.violations, Date.now() - 1);
  expect(raw.violations[0].nodes[0].fix).toBeUndefined();
  await context.close();
});
