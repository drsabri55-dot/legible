import AxeBuilder from "@axe-core/playwright";
import axeCore from "axe-core";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { makeHostGuard } from "./net";
import { BOT_NAME, loadRobots } from "./robots";
import type { RawNode, RawPage, RawRule, RawScan } from "./types";

export const MAX_PAGES = 6;
export const PAGE_TIMEOUT_MS = 30_000;
export const PAUSE_BETWEEN_PAGES_MS = 1000;
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const NODES_PER_RULE = 25;
const REVIEW_NODES_PER_RULE = 3;
const HTML_LIMIT = 800;
const SUMMARY_LIMIT = 400;
const MAX_PAYLOAD_BYTES = 3_500_000;

export class ScanError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export function userAgent(): string {
  const info = process.env.BOT_INFO_URL || `${(process.env.APP_URL || "https://legible.example").replace(/\/+$/, "")}/bot`;
  return `Mozilla/5.0 (compatible; ${BOT_NAME}/1.0; +${info})`;
}

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.isConnected()) return b;
  }
  browserPromise = chromium.launch({ args: ["--disable-dev-shm-usage"] });
  const b = await browserPromise;
  b.on("disconnected", () => {
    browserPromise = null;
  });
  return b;
}

export async function closeBrowser(): Promise<void> {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => {});
}

function truncate(value: string | undefined | null, limit: number): string {
  if (!value) return "";
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

type AxeResult = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type AxeRuleResult = AxeResult["violations"][number];

function contrastData(node: AxeRuleResult["nodes"][number]): Record<string, unknown> | null {
  for (const check of [...node.any, ...node.all, ...node.none]) {
    if (check.id !== "color-contrast" && check.id !== "color-contrast-enhanced") continue;
    const d = (check.data || {}) as Record<string, unknown>;
    return {
      fgColor: d.fgColor,
      bgColor: d.bgColor,
      contrastRatio: d.contrastRatio,
      expectedContrastRatio: d.expectedContrastRatio,
      fontSize: d.fontSize,
      fontWeight: d.fontWeight,
    };
  }
  return null;
}

function trimRule(rule: AxeRuleResult, keep: number): RawRule {
  const nodes: RawNode[] = rule.nodes.slice(0, keep).map((n) => ({
    html: truncate(n.html, HTML_LIMIT),
    target: n.target.map((t) => (Array.isArray(t) ? t.join(" ") : String(t))),
    failureSummary: truncate(n.failureSummary, SUMMARY_LIMIT) || undefined,
    impact: n.impact ?? null,
    data: rule.id === "color-contrast" ? contrastData(n) : null,
  }));
  return {
    id: rule.id,
    impact: rule.impact ?? null,
    help: rule.help,
    description: rule.description,
    helpUrl: rule.helpUrl,
    tags: rule.tags,
    nodeCount: rule.nodes.length,
    nodes,
  };
}

function toRawPage(url: string, title: string, axe: AxeResult): RawPage {
  return {
    url,
    status: "scanned",
    title: truncate(title, 200),
    violations: axe.violations.map((r) => trimRule(r, NODES_PER_RULE)),
    incomplete: axe.incomplete.map((r) => trimRule(r, REVIEW_NODES_PER_RULE)),
    passes: axe.passes.map((r) => ({ id: r.id, nodeCount: r.nodes.length })),
    inapplicable: axe.inapplicable.map((r) => r.id),
  };
}

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|mov|avi|ics|csv|xml|rss|json)$/i;

function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}

// Up to five more pages, taken from the site's navigation first. Sites with
// no <nav> fall back to the header, then to links anywhere on the page.
async function collectLinks(page: Page, base: URL): Promise<string[]> {
  // Passed as a string: tsx adds helper calls to compiled functions that do
  // not exist inside the page.
  const groups = (await page.evaluate(`
    [
      'nav a[href], [role="navigation"] a[href]',
      'header a[href]',
      'main a[href], footer a[href]',
      'a[href]'
    ].map(function (selector) {
      return Array.prototype.map.call(document.querySelectorAll(selector), function (a) { return a.href; });
    })
  `)) as string[][];
  const seen = new Set<string>([base.origin + base.pathname.replace(/\/$/, "") + base.search]);
  const out: string[] = [];
  for (const group of groups) {
    for (const href of group) {
      let u: URL;
      try {
        u = new URL(href);
      } catch {
        continue;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!sameSite(u.hostname, base.hostname)) continue;
      if (SKIP_EXTENSIONS.test(u.pathname)) continue;
      if (/\/(wp-admin|wp-login|login|logout|signin|signout|cart|checkout|account)(\/|$)/i.test(u.pathname)) continue;
      u.hash = "";
      const key = u.origin + u.pathname.replace(/\/$/, "") + u.search;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u.toString());
    }
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new ScanError(code)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function scanPage(context: BrowserContext, url: string, first: boolean) {
  const page = await context.newPage();
  try {
    return await withTimeout(
      (async () => {
        let response;
        try {
          response = await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
        } catch (e) {
          const msg = String((e as Error).message);
          if (msg.includes("ERR_BLOCKED_BY_CLIENT")) throw new ScanError("blocked_target", msg);
          throw new ScanError("unreachable", msg.split("\n")[0]);
        }
        if (!response) throw new ScanError("unreachable", "no response");
        const status = response.status();
        if (status >= 400) throw new ScanError("unreachable", `HTTP ${status}`);
        const type = response.headers()["content-type"] || "";
        if (type && !/html/i.test(type)) throw new ScanError("not_html", type);
        // Give late scripts a moment to render, without waiting forever on
        // pages that never go quiet (chat widgets, analytics beacons).
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
        // runOnly and resultTypes go in one options call: AxeBuilder.options()
        // replaces anything withTags() set earlier.
        const axe = await new AxeBuilder({ page })
          .options({ runOnly: { type: "tag", values: WCAG_TAGS }, resultTypes: ["violations", "incomplete"] })
          .analyze();
        const title = await page.title().catch(() => "");
        const finalUrl = page.url();
        const links = first ? await collectLinks(page, new URL(finalUrl)) : [];
        return { raw: toRawPage(finalUrl, title, axe), links, finalUrl };
      })(),
      PAGE_TIMEOUT_MS + 5000,
      "timeout",
    );
  } finally {
    await page.close().catch(() => {});
  }
}

function emptyPage(url: string, status: "skipped" | "failed", reason: string): RawPage {
  return { url, status, reason, violations: [], incomplete: [], passes: [], inapplicable: [] };
}

// Keeps the result under the size the site can accept by dropping stored
// example elements (never the counts) until it fits.
export function fitPayload(raw: RawScan): RawScan {
  for (const keep of [NODES_PER_RULE, 10, 5, 2, 1]) {
    for (const page of raw.pages) {
      for (const rule of page.violations) rule.nodes = rule.nodes.slice(0, keep);
      for (const rule of page.incomplete) rule.nodes = rule.nodes.slice(0, Math.min(keep, REVIEW_NODES_PER_RULE));
    }
    if (Buffer.byteLength(JSON.stringify(raw)) <= MAX_PAYLOAD_BYTES) return raw;
  }
  return raw;
}

export interface ScanOptions {
  onProgress?: (done: number, total: number) => void | Promise<void>;
  pauseMs?: number;
}

export async function scanSite(startUrl: string, opts: ScanOptions = {}): Promise<RawScan> {
  const startedAt = new Date().toISOString();
  const ua = userAgent();
  const start = new URL(startUrl);
  const guard = makeHostGuard();
  if (!(await guard(start.hostname))) throw new ScanError("blocked_target");

  const robots = await loadRobots(start.origin, ua);
  if (!robots.isAllowed(start.toString())) throw new ScanError("robots");

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: ua,
    serviceWorkers: "block",
    acceptDownloads: false,
    viewport: { width: 1280, height: 900 },
    locale: "en-GB",
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    let u: URL;
    try {
      u = new URL(request.url());
    } catch {
      return route.abort("blockedbyclient");
    }
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.protocol !== "http:" && u.protocol !== "https:") return route.abort("blockedbyclient");
    if (request.resourceType() === "media") return route.abort("blockedbyclient");
    return (await guard(u.hostname)) ? route.continue() : route.abort("blockedbyclient");
  });

  const pages: RawPage[] = [];
  let finalUrl = start.toString();
  try {
    const home = await scanPage(context, start.toString(), true);
    pages.push(home.raw);
    finalUrl = home.finalUrl;

    const allowed: string[] = [];
    for (const link of home.links) {
      if (allowed.length >= MAX_PAGES - 1) break;
      if (robots.isAllowed(link)) allowed.push(link);
      else if (pages.filter((p) => p.status === "skipped").length < 3) {
        pages.push(emptyPage(link, "skipped", "robots"));
      }
    }
    const total = 1 + allowed.length;
    await opts.onProgress?.(1, total);

    let done = 1;
    for (const link of allowed) {
      await new Promise((r) => setTimeout(r, Math.max(opts.pauseMs ?? PAUSE_BETWEEN_PAGES_MS, robots.crawlDelayMs)));
      try {
        const result = await scanPage(context, link, false);
        pages.push(result.raw);
      } catch (e) {
        const code = e instanceof ScanError ? e.message : "error";
        pages.push(emptyPage(link, "failed", code));
      }
      done++;
      await opts.onProgress?.(done, total);
    }
  } finally {
    await context.close().catch(() => {});
  }

  // Scanned pages first, in scan order; skipped and failed ones after.
  pages.sort((a, b) => Number(a.status !== "scanned") - Number(b.status !== "scanned"));

  return fitPayload({
    version: 1,
    startUrl: start.toString(),
    finalUrl,
    engine: { axe: axeCore.version, userAgent: ua },
    startedAt,
    finishedAt: new Date().toISOString(),
    pages,
  });
}
