import { expect, test } from "@playwright/test";
import { FIXTURE_URL, expectNoWcagViolations } from "./helpers";

// A page with no failures gets its free result and has nothing to buy.
test.use({ reducedMotion: "reduce" });

test("a site with no failures is not offered a report", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("Website address").fill(`${FIXTURE_URL}clean.html`);
  await page.getByRole("button", { name: "Scan a site" }).click();
  await page.waitForURL(/\/scan\/[0-9a-f-]{36}$/);
  const scanId = page.url().split("/").pop();

  await expect(page.getByText("Free result", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 2, name: "0 failures found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No failures found by the automated checks" })).toBeVisible();
  await expect(page.getByText("There is no report to buy, because it would only repeat this page.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checks that need a person" })).toBeVisible();
  await expect(page.getByText("Text does not stand out from its background")).toBeVisible();
  await expect(page.getByRole("button", { name: /Test the whole site/ })).toHaveCount(0);
  await expectNoWcagViolations(page);

  const res = await request.post("/api/checkout", { data: { scanId }, headers: { origin: "http://localhost:3100" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toBe("No failures were found, so there is no report to buy.");

  await page.goto(`/checkout/dev?scan=${scanId}`);
  await expect(page).toHaveURL(new RegExp(`/scan/${scanId}$`));
});
