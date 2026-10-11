import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";

const PORT = 5067;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(() => server.close());

it("serves the agent fixture pages and counts form posts", async () => {
  for (const name of ["clean", "trap", "focus", "long", "reflow", "table", "spacing", "reach", "post", "nav", "alt"]) {
    const res = await fetch(`http://127.0.0.1:${PORT}/agent/${name}.html`);
    expect(res.status, name).toBe(200);
  }
  for (const name of ["alt", "contrast", "label", "viewport"]) {
    expect((await fetch(`http://127.0.0.1:${PORT}/fixes/${name}.html`)).status, name).toBe(200);
  }
  expect(await (await fetch(`http://127.0.0.1:${PORT}/__posts`)).text()).toBe("0");
  await fetch(`http://127.0.0.1:${PORT}/agent/submit`, { method: "POST", body: "n=1" });
  expect(await (await fetch(`http://127.0.0.1:${PORT}/__posts`)).text()).toBe("1");
});
