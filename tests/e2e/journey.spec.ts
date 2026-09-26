import { expect, test } from "@playwright/test";
import { FIXTURE_URL, expectNoWcagViolations, outbox, uniqueEmail, waitForEmail } from "./helpers";

// The whole customer journey, in order: scan → free result → buy → report →
// PDF → email → account.
test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });

let resultUrl = "";
let reportUrl = "";
const buyer = uniqueEmail("buyer");

test("a visitor scans a site from the landing page and sees the free result", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Website address").fill(FIXTURE_URL);
  await page.getByRole("button", { name: "Scan a site" }).click();
  await page.waitForURL(/\/scan\/[0-9a-f-]{36}$/);
  resultUrl = page.url();

  // The scanning screen shows the same heading, so wait for the result itself.
  await expect(page.getByText("Free result")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1, name: "127.0.0.1" })).toBeVisible();
  await expect(page.getByText(/Scored \d+ out of 100, measured against WCAG 2\.1 Level AA across 4 pages/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Two of your issues, in full" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: /more issues? in the full report/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get the full report · $99" })).toBeVisible();
  await expect(page.getByText("Legible identifies issues measured against WCAG 2.1 Level AA.").first()).toBeVisible();
  await expectNoWcagViolations(page);
});

test("the visitor can email the free result to themselves", async ({ page }) => {
  const lead = uniqueEmail("lead");
  await page.goto(resultUrl);
  await page.getByLabel("Email me this result").fill(lead);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent. Check your inbox for a copy of this result.")).toBeVisible();
  const email = await waitForEmail(lead, "free-result");
  expect(email.subject).toBe("Your accessibility score for 127.0.0.1");
  expect(email.html).toContain(resultUrl.replace(/:\d+/, ":3100"));
});

test("buying the report creates it, shows it and emails it with the PDF", async ({ page }) => {
  await page.goto(resultUrl);
  await page.getByRole("button", { name: "Get the full report · $99" }).click();
  await page.waitForURL(/\/checkout\/dev\?scan=/);
  await page.getByLabel("Buyer email").fill(buyer);
  await page.getByRole("button", { name: "Pay $99 (test)" }).click();
  await page.waitForURL(/\/report\/[A-Za-z0-9_-]+\?welcome=1$/, { timeout: 60_000 });
  reportUrl = page.url().replace("?welcome=1", "");

  await expect(page.getByRole("status")).toContainText(`on its way to ${buyer}`);
  await expect(page.getByRole("heading", { level: 1, name: "127.0.0.1" })).toBeVisible();
  for (const name of ["127.0.0.1 at a glance", "Pages scanned", "Must fix", "How this report was made", "What this report can and cannot tell you"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 3, name: "Images have no text alternative" })).toBeVisible();
  await expect(page.getByText("Skipped: the site's robots.txt asks tools like ours not to visit it")).toBeVisible();
  await expect(page.locator(".rp-cover")).toContainText("This report identifies issues measured against WCAG 2.1 Level AA.");
  await expect(page.locator(".rp-limits")).toContainText("A result with no failures does not mean a site meets WCAG 2.1 AA or any law.");
  await expectNoWcagViolations(page);

  const email = await waitForEmail(buyer, "report-ready");
  expect(email.subject).toBe("Your Legible report for 127.0.0.1 is ready");
  expect(email.attachments).toMatch(/^legible-report-127\.0\.0\.1-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test("the PDF downloads", async ({ request }) => {
  const res = await request.get(`${reportUrl}/pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["content-disposition"]).toContain("attachment; filename=");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(20_000);
});

test("a scan can only be bought once", async ({ page, request }) => {
  await page.goto(resultUrl);
  await expect(page.getByRole("heading", { name: "The full report for this scan has been bought" })).toBeVisible();
  const scanId = resultUrl.split("/").pop();
  const res = await request.post("/api/checkout", {
    data: { scanId },
    headers: { origin: "http://localhost:3100" },
  });
  expect(res.status()).toBe(409);
});

test("the buyer signs in with an emailed link and finds the report", async ({ page }) => {
  await page.goto("/account");
  await page.getByLabel("Email address used at checkout").fill(buyer);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const email = await waitForEmail(buyer, "sign-in");
  const link = /href="(http:\/\/localhost:3100\/auth\/verify\?token=[A-Za-z0-9_-]+)"/.exec(email.html)![1];
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/account$/);
  await expect(page.getByText(`Signed in as ${buyer}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open report for 127.0.0.1" })).toHaveAttribute("href", new URL(reportUrl).pathname);
  await expectNoWcagViolations(page);

  // The link works once.
  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();

  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("strangers get the same answer but no email", async ({ page }) => {
  const stranger = uniqueEmail("stranger");
  await page.goto("/account");
  await page.getByLabel("Email address used at checkout").fill(stranger);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await outbox(stranger)).toEqual([]);
});
