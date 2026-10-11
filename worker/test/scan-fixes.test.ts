// Every scan tests its fixes; with the agent, the model writes the missing ones.
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { closeBrowser, scanSite } from "../src/scan";

const PORT = 5084;
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

const done = { calls: [{ name: "done", input: { summary: "ok" } }] };
const OUTLINE = { calls: [{ name: "fix", input: { kind: "css", code: "#bad:focus-visible { outline: 3px solid #000; outline-offset: 2px; }", note: "Adds a visible outline." } }] };

it("tests rule-based fixes on every scan, and names the builder", async () => {
  const raw = await scanSite(`${base}/fixes/alt.html`, { pauseMs: 10 });
  const alt = raw.pages[0].violations.find((v) => v.id === "image-alt")!;
  expect(alt.nodes[0].fix).toMatchObject({ status: "tested", source: "rule" });
  expect(raw.fixVersion).toBe(1);
  expect(raw.builtWith).toBe("WordPress");
});

it("lets the model write a fix where there is no rule-based one", async () => {
  const model = new ReplayModel([done, OUTLINE, OUTLINE, OUTLINE, OUTLINE]);
  const raw = await scanSite(`${base}/agent/focus.html`, { pauseMs: 10, agent: model });
  const focus = raw.pages[0].violations.find((v) => v.id === "legible-focus-visible")!;
  const bad = focus.nodes.find((n) => n.target[0] === "#bad")!;
  expect(bad.fix).toMatchObject({ kind: "css", status: "tested", source: "ai" });
});

it("writes no AI fixes once the scan's allowance is used up", async () => {
  const model = new ReplayModel([done, OUTLINE]);
  const raw = await scanSite(`${base}/agent/focus.html`, { pauseMs: 10, agent: model, fixBudget: { left: 0 } });
  expect(model.requests).toHaveLength(1);
  const focus = raw.pages[0].violations.find((v) => v.id === "legible-focus-visible")!;
  expect(focus.nodes.every((n) => n.fix === undefined)).toBe(true);
});

it("keeps the page's results when a fix call hangs past its time", async () => {
  const done = { calls: [{ name: "done", input: { summary: "ok" } }] };
  const replay = new ReplayModel([done]);
  let calls = 0;
  // Answers the agent, then never answers again (a stuck request).
  const stuck = {
    name: "stuck",
    turn: (req: Parameters<ReplayModel["turn"]>[0]) => (calls++ === 0 ? replay.turn(req) : new Promise<never>(() => {})),
  };
  const started = Date.now();
  const raw = await scanSite(`${base}/agent/focus.html`, { pauseMs: 10, agent: stuck, fixTimes: { ruleMs: 2000, aiMs: 2000 } });
  expect(Date.now() - started).toBeLessThan(60_000);
  expect(raw.pages[0].status).toBe("scanned");
  expect(raw.pages[0].violations.some((v) => v.id === "legible-focus-visible")).toBe(true);
}, 90_000);
