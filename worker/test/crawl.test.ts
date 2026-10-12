// The paid whole-site test walks the site breadth first, testing only pages
// the free scan did not, with the free scan's rules for what to skip.
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { crawlSite } from "../src/crawl";
import { closeBrowser } from "../src/scan";
import type { RawPage } from "../src/types";

const PORT = 5085;
const base = `http://127.0.0.1:${PORT}`;
let server: Server;
beforeAll(async () => {
  process.env.ALLOW_PRIVATE_TARGETS = "1";
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
  delete process.env.ALLOW_PRIVATE_TARGETS;
});

const done = [`${base}/`, `${base}/about.html`];

it("tests the pages the free scan did not, and skips what it skips", async () => {
  const pages: RawPage[] = [];
  const result = await crawlSite(`${base}/`, {
    done,
    maxPages: 50,
    pauseMs: 10,
    onPage: async (p) => {
      pages.push(p);
      return { stop: false };
    },
  });
  const paths = pages.map((p) => new URL(p.url).pathname);
  expect(result).toMatchObject({ reason: "done", tested: pages.length });
  expect(paths).toContain("/contact.html");
  expect(paths).toContain("/services.html");
  for (const never of ["/", "/about.html", "/index.html", "/private.html", "/login", "/brochure.pdf", "/missing.html"]) {
    expect(paths, never).not.toContain(never);
  }
  expect(pages.every((p) => p.status === "scanned" && new URL(p.url).host === `127.0.0.1:${PORT}`)).toBe(true);
  expect(new Set(paths).size).toBe(paths.length);
}, 120_000);

it("stops at the page limit, counting the pages already done", async () => {
  const pages: RawPage[] = [];
  const result = await crawlSite(`${base}/`, {
    done,
    maxPages: done.length + 1,
    pauseMs: 10,
    onPage: async (p) => {
      pages.push(p);
      return { stop: false };
    },
  });
  expect(result).toEqual({ reason: "limit", tested: 1 });
  expect(pages).toHaveLength(1);
}, 60_000);

it("stops when the site says so", async () => {
  const result = await crawlSite(`${base}/`, { done, maxPages: 50, pauseMs: 10, onPage: async () => ({ stop: true }) });
  expect(result).toEqual({ reason: "stopped", tested: 1 });
}, 60_000);
