import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { closeBrowser, scanSite } from "../src/scan";

const PORT = 5075;
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

it("adds the agent's findings to each page and totals its usage", async () => {
  const shots: string[] = [];
  const done = { calls: [{ name: "done", input: { summary: "ok" } }] };
  const raw = await scanSite(`http://127.0.0.1:${PORT}/agent/focus.html`, {
    pauseMs: 10,
    agent: new ReplayModel([done, done, done, done, done, done]),
    onShot: (id) => void shots.push(id),
  });
  const home = raw.pages[0];
  expect(home.violations.map((v) => v.id)).toContain("legible-focus-visible");
  expect(home.passes.map((p) => p.id)).toContain("legible-reflow");
  expect(home.agent).toMatchObject({ status: "tested" });
  expect(raw.agent).toMatchObject({ model: "replay" });
  expect(raw.agent!.usage.inputTokens).toBeGreaterThan(0);
  expect(shots.length).toBeGreaterThan(0);
});

it("leaves scans exactly as before without an agent", async () => {
  const raw = await scanSite(`http://127.0.0.1:${PORT}/agent/focus.html`, { pauseMs: 10 });
  expect(raw.pages[0].violations.some((v) => v.id.startsWith("legible-"))).toBe(false);
  expect(raw.pages[0].agent).toBeUndefined();
  expect(raw.agent).toBeUndefined();
});

it("finishes the scan when screenshots cannot be stored, keeping every finding", async () => {
  const done = { calls: [{ name: "done", input: { summary: "ok" } }] };
  const raw = await scanSite(`http://127.0.0.1:${PORT}/agent/focus.html`, {
    pauseMs: 10,
    agent: new ReplayModel([done]),
    onShot: () => {
      throw new Error("storage down");
    },
  });
  const home = raw.pages[0];
  expect(home.status).toBe("scanned");
  const focus = home.violations.find((v) => v.id === "legible-focus-visible");
  expect(focus?.nodes[0].shot).toBeUndefined();
  expect(home.passes.some((p) => !p.id.startsWith("legible-"))).toBe(true); // axe passes kept
});

it("runs the agent only on pages the scan keeps, never on duplicates or redirects away", async () => {
  const model = new ReplayModel([]);
  const raw = await scanSite(`http://127.0.0.1:${PORT}/`, { pauseMs: 10, agent: model });
  const scanned = raw.pages.filter((p) => p.status === "scanned");
  expect(scanned.length).toBe(4);
  expect(scanned.every((p) => p.agent)).toBe(true);
  // One opening request per kept page: /index.html (same page), /home and
  // /elsewhere (redirects) never reach the agent.
  expect(model.requests.length).toBe(scanned.length);
}, 120_000);
