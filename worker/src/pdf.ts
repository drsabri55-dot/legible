import { getBrowser } from "./scan";

// Prints a Legible report page to an A4 PDF. Only pages on the site's own
// address (APP_URL) are printed, and the page may only load from there.
export async function printPdf(url: string, appUrl: string): Promise<Buffer> {
  const target = new URL(url);
  const app = new URL(appUrl);
  if (target.origin !== app.origin) throw new Error("PDF source must be on APP_URL");

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1240, height: 1754 } });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.origin === app.origin || u.protocol === "data:" ? route.continue() : route.abort("blockedbyclient");
  });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    if (!res || !res.ok()) throw new Error(`Report page answered ${res?.status() ?? "nothing"}`);
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await context.close().catch(() => {});
  }
}
