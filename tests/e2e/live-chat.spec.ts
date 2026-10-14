// Phase 5 in a real browser: the live view, the chat and the AI agent page,
// each checked for WCAG failures and keyboard use.
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_URL, expectNoWcagViolations, seedRunningScan } from "./helpers";

test.use({ reducedMotion: "reduce" });

// Scans the fixture site from the landing page and waits for the free result,
// as journey.spec.ts does.
async function finishedFreeResult(page: Page) {
  await page.goto("/");
  await page.getByLabel("Website address").fill(FIXTURE_URL);
  await page.getByRole("button", { name: "Scan a site" }).click();
  await page.waitForURL(/\/scan\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Free result", { exact: true })).toBeVisible({ timeout: 90_000 });
}

test("the live view shows the agent's step, the pages and a Pause button", async ({ page }) => {
  const id = await seedRunningScan([
    { title: "Home", kind: "page", note: "Opened the page." },
    { title: "Home", kind: "done", note: "Finished this page." },
    { title: "Menu", kind: "page", note: "Opened the page." },
    { title: "Menu", kind: "step", note: "Pressed Tab. Focus moved to “Visit us”." },
  ]);
  await page.goto(`/scan/${id}`);
  await expect(page.getByText("Testing page 2 of 6: Menu")).toBeVisible();
  await expect(page.getByRole("img", { name: /The Menu page, as the agent sees it\. Step 4/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause live view" })).toBeVisible();
  await page.getByRole("button", { name: "Pause live view" }).click();
  await expect(page.getByRole("button", { name: "Resume live view" })).toHaveAttribute("aria-pressed", "true");
  await expectNoWcagViolations(page);
});

test("the live view and the chat work by keyboard alone, in reading order", async ({ page }) => {
  const id = await seedRunningScan([{ title: "Home", kind: "page", note: "Opened the page." }]);
  await page.goto(`/scan/${id}`);
  // The live view arrives with the first poll.
  await expect(page.getByRole("button", { name: "Pause live view" })).toBeVisible();
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate("document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim()"));
  }
  const pause = order.indexOf("Pause live view");
  const firstSuggestion = order.indexOf("What have you found so far?");
  expect(pause).toBeGreaterThan(-1);
  expect(firstSuggestion).toBeGreaterThan(pause);
});

test("a question on the free result is answered, announced and counted", async ({ page }) => {
  test.setTimeout(150_000);
  await finishedFreeResult(page);
  const chat = page.getByRole("region", { name: "Ask about your result" });
  await chat.getByRole("button", { name: "What should I fix first?" }).click();
  await expect(chat.locator("ol").getByText("Test answer to: What should I fix first?")).toBeVisible();
  await expect(chat.locator("[aria-live=polite]")).toContainText("Test answer to: What should I fix first?");
  await expect(chat.getByText("4 of 5 questions left")).toBeVisible();
  await expectNoWcagViolations(page);
});

test("after 5 questions the box gives way to the offer", async ({ page }) => {
  test.setTimeout(150_000);
  await finishedFreeResult(page);
  const chat = page.getByRole("region", { name: "Ask about your result" });
  for (let i = 1; i <= 5; i++) {
    await chat.getByLabel("Your question").fill(`Question ${i}`);
    await chat.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(chat.locator("ol").getByText(`Test answer to: Question ${i}`)).toBeVisible();
  }
  await expect(chat.getByText("You have used your 5 questions.", { exact: false })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Test the whole site · $99" })).toBeVisible();
  await expect(chat.getByLabel("Your question")).toHaveCount(0);
});

test("the landing button opens the AI agent page, which goes straight to the chat", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Ask our AI agent about your site" }).click();
  await expect(page.getByRole("heading", { name: "Ask our agent about your site" })).toBeVisible();
  await expectNoWcagViolations(page);
  await page.getByLabel("Website address").fill(FIXTURE_URL);
  await page.getByRole("button", { name: "Start the chat" }).click();
  await expect(page).toHaveURL(/\/agent\/[0-9a-f-]{36}$/);
  await page.getByLabel("Your question").fill("Hello");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByRole("region", { name: "Ask about this scan" }).locator("ol").getByText("Test answer to: Hello")).toBeVisible();
  await expectNoWcagViolations(page);
});
