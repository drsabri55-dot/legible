// Scans the fixture website in a real browser. Needs Chromium
// (npx playwright install chromium).
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { closeBrowser, fitPayload, scanSite, ScanError } from "../src/scan";

const PORT = 5066;
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

describe("scanSite", () => {
  it("scans the home page and navigation pages, obeying robots.txt", async () => {
    const progress: string[] = [];
    const raw = await scanSite(`http://127.0.0.1:${PORT}/`, {
      pauseMs: 50,
      onProgress: (d, t) => void progress.push(`${d}/${t}`),
    });
    const scanned = raw.pages.filter((p) => p.status === "scanned").map((p) => new URL(p.url).pathname);
    // Broken, challenge, duplicate and off-site links are replaced by later
    // ones, so Contact and Services are still reached.
    expect(scanned).toEqual(["/", "/about.html", "/contact.html", "/services.html"]);
    expect(raw.pages.find((p) => p.url.endsWith("/private.html"))).toMatchObject({ status: "skipped", reason: "robots" });
    expect(raw.pages.find((p) => p.url.endsWith("/missing.html"))).toMatchObject({ status: "failed", reason: "not_found: HTTP 404" });
    expect(raw.pages.find((p) => p.url.endsWith("/challenge.html"))).toMatchObject({ status: "failed", reason: "refused: bot challenge" });
    // Never visited or silently dropped: sign-in link, PDF, the redirect home and the off-site redirect.
    for (const gone of ["/login", ".pdf", "/home", "/elsewhere", "localhost"]) {
      expect(raw.pages.some((p) => p.url.includes(gone)), gone).toBe(false);
    }
    expect(progress[0]).toBe("1/6");
    expect(progress.at(-1)).toBe("4/4");

    const home = raw.pages[0];
    const ids = home.violations.map((v) => v.id).sort();
    for (const id of ["button-name", "color-contrast", "html-has-lang", "image-alt", "label", "meta-viewport"]) {
      expect(ids).toContain(id);
    }
    // Only WCAG A/AA rules: no best-practice rules such as "region".
    expect(ids).not.toContain("region");
    expect(home.violations.find((v) => v.id === "image-alt")?.nodeCount).toBe(2);
    const contrast = home.violations.find((v) => v.id === "color-contrast")!;
    expect(contrast.nodes[0].data).toMatchObject({ fgColor: "#aaaaaa", bgColor: "#ffffff" });

    const contact = raw.pages.find((p) => p.url.endsWith("/contact.html"))!;
    expect(contact.violations.map((v) => v.id).sort()).toEqual(["link-name", "select-name"]);
    expect(raw.engine.userAgent).toContain("LegibleBot/1.0");
  });

  it("refuses private addresses when not in test mode", async () => {
    delete process.env.ALLOW_PRIVATE_TARGETS;
    await expect(scanSite(`http://127.0.0.1:${PORT}/`)).rejects.toMatchObject({ code: "blocked_target" });
    process.env.ALLOW_PRIVATE_TARGETS = "1";
  });

  it("reports an unreachable site", async () => {
    await expect(scanSite("http://127.0.0.1:5999/")).rejects.toBeInstanceOf(ScanError);
  });

  it("fails a start page that is a bot challenge or missing, with the right reason", async () => {
    await expect(scanSite(`http://127.0.0.1:${PORT}/challenge.html`)).rejects.toMatchObject({ code: "refused" });
    await expect(scanSite(`http://127.0.0.1:${PORT}/missing.html`)).rejects.toMatchObject({ code: "not_found" });
  });

  it("tells a website that does not exist apart from a private address", async () => {
    delete process.env.ALLOW_PRIVATE_TARGETS;
    await expect(scanSite("https://no-such-site-legible-test.invalid/")).rejects.toMatchObject({ code: "unresolvable" });
    process.env.ALLOW_PRIVATE_TARGETS = "1";
  });
});

describe("fitPayload", () => {
  it("drops stored examples, never counts, until the result fits", () => {
    const big = "x".repeat(5000);
    const nodes = Array.from({ length: 25 }, () => ({ html: big, target: ["#a"] }));
    const rule = { id: "image-alt", impact: "critical", help: "", description: "", helpUrl: "", tags: [], nodeCount: 999, nodes };
    const raw = {
      version: 1 as const,
      startUrl: "https://x.example/",
      engine: { axe: "", userAgent: "" },
      startedAt: "",
      finishedAt: "",
      pages: Array.from({ length: 6 }, () => ({
        url: "https://x.example/",
        status: "scanned" as const,
        violations: Array.from({ length: 10 }, () => ({ ...rule, nodes: [...nodes] })),
        incomplete: [],
        passes: [],
        inapplicable: [],
      })),
    };
    const fitted = fitPayload(raw);
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(3_500_000);
    expect(fitted.pages[0].violations[0].nodeCount).toBe(999);
  });
});
