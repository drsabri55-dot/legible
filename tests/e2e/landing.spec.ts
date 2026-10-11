import { expect, test } from "@playwright/test";
import { expectNoWcagViolations, textOverCanvasFailures } from "./helpers";

test.describe("landing page, reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows all seven chapters with the approved copy and no loading gate", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Legible — accessibility reports for small business websites");
    await expect(page.locator("[data-chap]")).toHaveCount(7);
    await expect(page.locator('[data-a="gate"]')).toBeHidden();
    const text = await page.locator("main").innerText();
    for (const line of [
      "Legible tests your site against WCAG 2.1 AA and shows you exactly what to fix.",
      "What Legible is, and why the trip is worth taking.",
      "Readable findings",
      "Fixes in priority order",
      "A dated record",
      "What a screen reader hears on a typical checkout page.",
      "Button has no accessible name",
      "Label contrast is 2.3:1, below the 4.5:1 minimum",
      "failures, not warnings",
      "Twelve of them stop someone from finishing the form today. Everything else queues behind those.",
      "32 points to go. Twelve fixes close most of the gap.",
      "You landed. The free scan tests your home page and five more, and shows how to fix each problem, in the order to do them.",
      "The full report tests your whole site, up to 50 pages, with a PDF to share, for a one-time $99.",
    ]) {
      expect(text).toContain(line);
    }
    // The accessible name is what a screen reader announces: the sentence
    // once, not the animated word copies.
    await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(
      "Every site claims to be accessible. Few are ever read as one.",
    );
    await expect(page.getByRole("heading", { name: "Enter your site and we will test it." })).toBeVisible();
    await expect(page.locator("footer")).toContainText(
      "Legible identifies issues measured against WCAG 2.1 Level AA. Automated testing cannot detect every issue, so manual review is recommended.",
    );
    await expect(page.locator("footer")).toContainText("An independent audit. No overlay widgets.");
  });

  test("passes WCAG 2.1 A and AA checks itself", async ({ page }) => {
    await page.goto("/");
    await expectNoWcagViolations(page);
  });

  test("checks the address before starting a scan", async ({ page }) => {
    await page.goto("/");
    const field = page.getByLabel("Website address");
    await field.fill("not a website");
    await page.getByRole("button", { name: "Scan a site" }).click();
    await expect(page.getByText("Enter a website address, like yourbusiness.com.")).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("landing page, full motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("plays the loading gate, then the scroll story", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.locator('[data-a="gate"]')).toBeVisible();
    await expect(page.locator('[data-a="gate"]')).toBeHidden({ timeout: 6000 });
    // Headlines are split into animated words, with the sentence kept once
    // for screen readers.
    await expect(page.locator('[data-a="ink0"] [data-split] > span')).toHaveCount(12);
    await expect(page.locator('[data-a="ink0"] .sr-only')).toHaveText(
      "Every site claims to be accessible. Few are ever read as one.",
    );

    const top = await page.locator('[data-a="s3"]').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.evaluate((y) => window.scrollTo(0, y + 900), top);
    await expect(page.locator('[data-a="idx"]')).toHaveText("05 / 07");
    await expect(page.locator('[data-a="total"]')).toHaveText("143", { timeout: 10_000 });
    expect(errors).toEqual([]);
  });
});

test.describe("landing page text over the moon", () => {
  test.use({ reducedMotion: "reduce" });

  for (const [width, height] of [
    [320, 800],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ]) {
    test(`keeps its contrast at ${width}px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.waitForTimeout(800); // the moon texture loads
      const chapters = await page.evaluate(() =>
        [...document.querySelectorAll("[data-chap]")].map((s) => [s.getBoundingClientRect().top + scrollY, s.clientHeight]),
      );
      const failures: string[] = [];
      for (const [i, [top, h]] of chapters.entries()) {
        for (const frac of [0, 0.5]) {
          await page.evaluate((y) => window.scrollTo(0, y), top + frac * Math.max(0, h - height));
          await page.waitForTimeout(300);
          for (const f of await textOverCanvasFailures(page)) failures.push(`chapter ${i + 1}: ${f}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

test.describe("landing page shortcuts", () => {
  test.use({ reducedMotion: "no-preference" });

  test("'Scan your site' jumps to the form and puts the cursor in it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-a="gate"]')).toBeHidden({ timeout: 6000 });
    await page.getByRole("link", { name: "Scan your site" }).click();
    await expect(page.getByLabel("Website address")).toBeFocused();
    await expect(page.getByLabel("Website address")).toBeInViewport();
  });

  test("shows the loading screen on the first visit only", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-a="gate"]')).toBeVisible();
    await expect(page.locator('[data-a="gate"]')).toBeHidden({ timeout: 6000 });
    await page.reload();
    await expect(page.locator('[data-a="gate"]')).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the moon stops redrawing while the reader is idle, and resumes on scroll", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __draws: number };
      w.__draws = 0;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        w.__draws++;
        return clear.apply(this, args);
      };
    });
    await page.goto("/");
    await expect(page.locator('[data-a="gate"]')).toBeHidden({ timeout: 6000 });
    const drawsIn = async (ms: number) => {
      const start = await page.evaluate(() => (window as unknown as { __draws: number }).__draws);
      await page.waitForTimeout(ms);
      return (await page.evaluate(() => (window as unknown as { __draws: number }).__draws)) - start;
    };
    expect(await drawsIn(1000)).toBeGreaterThan(20);
    await page.waitForTimeout(11_000);
    expect(await drawsIn(1000)).toBe(0);
    await page.mouse.wheel(0, 500);
    expect(await drawsIn(1000)).toBeGreaterThan(20);
  });

  test("the header fits on a small phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    const boxes = await page.evaluate(() =>
      ['header a[aria-label="Legible, home"]', 'header a[href="#scan"]', '[data-a="idx"]'].map((sel) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
    expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left);
    expect(boxes[1].right).toBeLessThanOrEqual(boxes[2].left);
    expect(boxes[2].right).toBeLessThanOrEqual(320);
  });
});

test("links shared elsewhere show the share image", async ({ page, request }) => {
  await page.goto("/");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toContain("/opengraph-image");
  const res = await request.get(new URL(og!).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
});
