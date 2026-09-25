import { expect, test } from "@playwright/test";

const ORIGIN = { origin: "http://localhost:3100" };

test("the scan API refuses cross-site requests and bad addresses", async ({ request }) => {
  expect((await request.post("/api/scans", { data: { url: "example.com" } })).status()).toBe(403);
  expect((await request.post("/api/scans", { data: { url: "example.com" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
  const bad = await request.post("/api/scans", { data: { url: "javascript:alert(1)" }, headers: ORIGIN });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe("Enter a website address, like yourbusiness.com.");
});

test("worker callbacks and scheduled jobs need their secrets", async ({ request }) => {
  const id = "00000000-0000-4000-8000-000000000000";
  expect((await request.post(`/api/worker/scans/${id}`, { data: { type: "failed", error: "x" } })).status()).toBe(401);
  expect(
    (
      await request.post(`/api/worker/scans/${id}`, {
        data: { type: "failed", error: "x" },
        headers: { authorization: "Bearer wrong" },
      })
    ).status(),
  ).toBe(401);
  expect((await request.get("/api/cron/daily")).status()).toBe(401);
  const cron = await request.get("/api/cron/daily", { headers: { authorization: "Bearer e2e-cron-secret" } });
  expect(cron.status()).toBe(200);
  expect(await cron.json()).toMatchObject({ ok: true });
});

test("private pages stay private", async ({ request }) => {
  expect((await request.get("/report/not-a-real-token-at-all-000000")).status()).toBe(404);
  expect((await request.get("/report/not-a-real-token-at-all-000000/pdf")).status()).toBe(404);
  expect((await request.get("/scan/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  expect((await request.get("/admin")).status()).toBe(404);
  expect((await request.get("/dev/emails")).status()).toBe(404);
  expect((await request.post("/api/unsubscribe?e=a%40b.com&s=bad")).status()).toBe(400);
});

test("pages send security headers and keep results out of search engines", async ({ request }) => {
  const home = await request.get("/");
  expect(home.headers()["x-frame-options"]).toBe("DENY");
  expect(home.headers()["x-content-type-options"]).toBe("nosniff");
  expect(home.headers()["x-powered-by"]).toBeUndefined();
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /report/");
  expect(robots).toContain("Disallow: /scan/");
});

test("static pages pass WCAG checks", async ({ page }) => {
  const { expectNoWcagViolations } = await import("./helpers");
  for (const path of ["/terms", "/privacy", "/bot", "/account", "/does-not-exist"]) {
    await page.goto(path);
    await expectNoWcagViolations(page);
  }
});
