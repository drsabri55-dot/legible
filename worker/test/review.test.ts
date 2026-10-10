import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { secondOpinion } from "../src/agent/review";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5073;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

it("keeps a finding only when the second pass agrees, using the page's real code", async () => {
  const page = await (await getBrowser()).newPage();
  await page.goto(`http://127.0.0.1:${PORT}/agent/alt.html`);
  const agree = new ReplayModel([{ calls: [{ name: "verdict", input: { problem: true, reason: "The alt text is a file name, not a description." } }] }]);
  const kept = await secondOpinion(agree, page, { kind: "image-description", selector: "#photo", reason: "Alt is image123" });
  expect(kept.review).toMatchObject({ kind: "image-description", selector: "#photo", reason: "The alt text is a file name, not a description." });
  expect(kept.review!.html).toContain('alt="image123"');
  expect(kept.shot?.length).toBeGreaterThan(100);
  // The second pass saw the element's code and a picture of it.
  const sent = JSON.stringify(agree.requests[0].messages);
  expect(sent).toContain("image123");
  expect(sent).toContain('"type":"image"');

  const disagree = new ReplayModel([{ calls: [{ name: "verdict", input: { problem: false, reason: "Fine." } }] }]);
  expect((await secondOpinion(disagree, page, { kind: "link-purpose", selector: "#more", reason: "Click here" })).review).toBeNull();

  const silent = new ReplayModel([{ text: "I am not sure." }]);
  expect((await secondOpinion(silent, page, { kind: "link-purpose", selector: "#more", reason: "x" })).review).toBeNull();

  const missing = new ReplayModel([]);
  expect((await secondOpinion(missing, page, { kind: "link-purpose", selector: "#nope", reason: "x" })).review).toBeNull();
  expect(missing.requests.length).toBe(0); // no element, no model call
  await page.close();
});
