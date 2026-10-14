import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

export const FIXTURE_URL = "http://127.0.0.1:5055/";
const OUTBOX = path.join(process.cwd(), ".data", "outbox");

// Our own pages must pass the same test we sell: no WCAG 2.0/2.1 A or AA
// violations.
export async function expectNoWcagViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

export interface OutboxEmail {
  file: string;
  to: string;
  subject: string;
  attachments: string;
  html: string;
}

// Emails written by the development mailer, newest first.
export async function outbox(to: string, template?: string): Promise<OutboxEmail[]> {
  let files: string[] = [];
  try {
    files = (await readdir(OUTBOX)).filter((f) => f.endsWith(".html"));
  } catch {
    return [];
  }
  const out: OutboxEmail[] = [];
  for (const file of files.sort().reverse()) {
    if (template && !file.endsWith(`-${template}.html`)) continue;
    const html = await readFile(path.join(OUTBOX, file), "utf8");
    const m = /^<!-- To: (.*?) \| Subject: (.*?) \| Attachments: (.*?) -->/.exec(html);
    if (m && m[1] === to) out.push({ file, to: m[1], subject: m[2], attachments: m[3], html });
  }
  return out;
}

export async function waitForEmail(to: string, template: string, timeout = 30_000): Promise<OutboxEmail> {
  let found: OutboxEmail | undefined;
  await expect
    .poll(async () => {
      found = (await outbox(to, template))[0];
      return !!found;
    }, { timeout })
    .toBe(true);
  return found!;
}

export function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@legible.test`;
}

// Contrast of a form field's border against the field's own fill. WCAG 1.4.11
// asks 3:1 for the edge that shows where a control is. A see-through border is
// mixed over the fill first, as the browser paints it.
export async function borderContrast(field: Locator): Promise<number> {
  return field.evaluate((el) => {
    const parse = (s: string) => {
      const n = (s.match(/[\d.]+/g) || []).map(Number);
      // color(srgb …) gives channels from 0 to 1; rgb() and rgba() from 0 to 255.
      const rgb = s.startsWith("color(") ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
      return { rgb, a: n.length > 3 ? n[3] : 1 };
    };
    const cs = getComputedStyle(el);
    const fill = parse(cs.backgroundColor).rgb;
    const edge = parse(cs.borderTopColor);
    const painted = edge.rgb.map((c, i) => c * edge.a + fill[i] * (1 - edge.a));
    const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const [hi, lo] = [lum(painted), lum(fill)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });
}

// Contrast of every visible text box in <main> against what is really behind
// it (canvas included): the text is hidden, the page is photographed, and the
// brightest 5% of pixels under each box are compared with the text colour.
// axe cannot do this for text over the landing page's moon.
export async function textOverCanvasFailures(page: Page): Promise<string[]> {
  const items = await page.evaluate(() => {
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = (rgb: string) => {
      const m = (rgb.match(/[\d.]+/g) || []).map(Number);
      return 0.2126 * lin(m[0] / 255) + 0.7152 * lin(m[1] / 255) + 0.0722 * lin(m[2] / 255);
    };
    const out: { text: string; x: number; y: number; w: number; h: number; L: number; need: number }[] = [];
    // Text scrolled up behind the sticky header is covered by it, not read.
    const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const walker = document.createTreeWalker(document.querySelector("main")!, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const el = n.parentElement!;
      if (!n.textContent?.trim() || el.closest(".sr-only")) continue;
      const cs = getComputedStyle(el);
      // Skip invisible text: hidden, fully faded, or transparent (the
      // headline animation's outline copies are transparent by design).
      const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(cs.color);
      if (cs.visibility === "hidden" || cs.opacity === "0" || (alpha && Number(alpha[1]) === 0)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.top < headerBottom || r.top > innerHeight || r.width < 2) continue;
        const size = parseFloat(cs.fontSize);
        const need = size >= 24 || (parseInt(cs.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
        out.push({ text: n.textContent.trim().slice(0, 40), x: r.left, y: r.top, w: r.width, h: r.height, L: lum(cs.color), need });
      }
    }
    return out;
  });
  const style = await page.addStyleTag({
    content:
      "main *{color:transparent!important;-webkit-text-stroke:0!important} main input,main .btn{background:transparent!important;border-color:transparent!important}",
  });
  // Two frames, so the hidden-text style is painted before the photograph.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(100);
  const shot = (await page.screenshot()).toString("base64");
  await style.evaluate((s) => (s as Element).remove());
  return page.evaluate(
    async ({ shot, items }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + shot;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const scale = img.width / innerWidth;
      const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const bad: string[] = [];
      for (const it of items) {
        const d = g.getImageData(it.x * scale, it.y * scale, Math.max(1, it.w * scale), Math.max(1, it.h * scale)).data;
        const ls: number[] = [];
        for (let i = 0; i < d.length; i += 4) ls.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
        ls.sort((a, b) => a - b);
        const bg = ls[Math.floor(ls.length * 0.95)] ?? 0;
        const ratio = (Math.max(it.L, bg) + 0.05) / (Math.min(it.L, bg) + 0.05);
        if (ratio < it.need) bad.push(`"${it.text}" ${ratio.toFixed(2)}:1 (needs ${it.need})`);
      }
      return bad;
    },
    { shot, items },
  );
}

const E2E_DB = "postgres://postgres:postgres@127.0.0.1:54331/legible";
// A 1×1 grey JPEG.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

// A scan that is running with the agent, with these live events and a
// picture, written straight into the e2e database. It never finishes.
export async function seedRunningScan(events: { title: string; kind: string; note: string }[]): Promise<string> {
  const sql = postgres(E2E_DB, { max: 1 });
  try {
    const done = events.filter((e) => e.kind === "done").length;
    const [scan] = await sql<{ id: string }[]>`
      insert into scans (url, host, status, pages_done, pages_total, agent, started_at)
      values ('https://seed.test/', 'seed.test', 'running', ${done}, 6, 'on', now()) returning id`;
    let step = 0;
    let page = "";
    for (const e of events) {
      if (e.kind === "page") page = `https://seed.test/${e.title.toLowerCase()}`;
      await sql`insert into scan_events (scan_id, step, page, title, kind, note)
                values (${scan.id}, ${++step}, ${page}, ${e.title}, ${e.kind}, ${e.note})`;
    }
    await sql`insert into scan_live (scan_id, frame, note) values (${scan.id}, ${TINY_JPEG}, 'seed')`;
    return scan.id;
  } finally {
    await sql.end();
  }
}
