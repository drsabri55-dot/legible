// `npm run report-preview` (with `npm run dev` running)
// Makes the two pictures shown beside "Get the full report": the cover and
// the first must-fix page of a sample report, as they print in the PDF. The
// sample is a made-up site, yourbusiness.com, so no real business appears on
// the page. It is stored in the local database only while the pictures are
// taken, then deleted. Output: public/report-preview/{cover,issue}.jpg
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { createReportOnce, createScan, completeScan, upsertUser } from "../src/lib/data";
import { db } from "../src/lib/db";
import { buildReport, freeSummary } from "../src/lib/report/model";
import type { RawNode, RawPage, RawRule, RawScan } from "../src/types/scan";

const BASE = process.env.APP_URL || "http://localhost:3000";
const OUT = "public/report-preview";
const SITE = "https://yourbusiness.com/";

function rule(id: string, impact: string, tags: string[], nodes: RawNode[]): RawRule {
  return { id, impact, help: id, description: id, helpUrl: "", tags, nodeCount: nodes.length, nodes };
}
const node = (html: string, target: string, data?: RawNode["data"]): RawNode => ({
  html,
  target: [target],
  data: data ?? null,
});

// What a small business site typically fails: pictures with no description,
// form fields with no label, an icon-only menu button, pale text.
const menu = node(
  '<button class="menu-toggle"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"></path></svg></button>',
  "header > .menu-toggle",
);
const social = node(
  '<a href="https://instagram.com/yourbusiness"><i class="icon-instagram"></i></a>',
  "footer .social > a",
);
const pale = node('<p class="hours">Open Monday to Saturday, 9am to 6pm</p>', ".hero > .hours", {
  fgColor: "#a3a3a3",
  bgColor: "#ffffff",
  contrastRatio: 2.52,
  expectedContrastRatio: "4.5:1",
  fontSize: "12.0pt (16px)",
  fontWeight: "normal",
});
const PASSES = [
  "html-has-lang",
  "document-title",
  "html-lang-valid",
  "list",
  "listitem",
  "bypass",
  "duplicate-id-aria",
];

function page(path: string, title: string, violations: RawRule[]): RawPage {
  return {
    url: new URL(path, SITE).toString(),
    status: "scanned",
    title,
    violations,
    incomplete: [],
    passes: PASSES.map((id) => ({ id, nodeCount: 3 })),
    inapplicable: [],
  };
}
const everyPage = () => [
  rule("button-name", "critical", ["wcag2a", "wcag412"], [menu]),
  rule("link-name", "serious", ["wcag2a", "wcag244", "wcag412"], [social]),
];

export const SAMPLE: RawScan = {
  version: 1,
  startUrl: SITE,
  finalUrl: SITE,
  engine: { axe: "4.13.0", userAgent: "LegibleBot/1.0" },
  startedAt: "2026-09-21T09:00:00.000Z",
  finishedAt: "2026-09-21T09:01:10.000Z",
  pages: [
    page("/", "Your Business · Home", [
      ...everyPage(),
      rule(
        "image-alt",
        "critical",
        ["wcag2a", "wcag111"],
        [
          node('<img src="/images/shopfront.jpg">', ".hero > img"),
          node('<img src="/images/team.jpg" class="team">', ".team"),
        ],
      ),
      rule("color-contrast", "serious", ["wcag2aa", "wcag143"], [pale]),
    ]),
    page("/services", "Services · Your Business", [
      ...everyPage(),
      rule(
        "image-alt",
        "critical",
        ["wcag2a", "wcag111"],
        [node('<img src="/images/service-1.jpg">', ".card:nth-child(1) > img")],
      ),
    ]),
    page("/about", "About us · Your Business", [...everyPage()]),
    page("/contact", "Contact · Your Business", [
      ...everyPage(),
      rule(
        "label",
        "critical",
        ["wcag2a", "wcag412"],
        [
          node('<input type="text" name="name" placeholder="Your name">', '#contact-form > input[name="name"]'),
          node('<input type="email" name="email" placeholder="Email">', '#contact-form > input[type="email"]'),
        ],
      ),
    ]),
    page("/book", "Book a visit · Your Business", [
      ...everyPage(),
      rule(
        "label",
        "critical",
        ["wcag2a", "wcag412"],
        [node('<input type="tel" name="phone" placeholder="Phone">', '#booking > input[type="tel"]')],
      ),
      rule(
        "select-name",
        "critical",
        ["wcag2a", "wcag412"],
        [node('<select name="time"><option>Morning</option><option>Afternoon</option></select>', "#booking > select")],
      ),
    ]),
  ],
};

const raw = SAMPLE;
const report = buildReport(raw);
const scan = await createScan({ url: SITE, host: "yourbusiness.com", ipHash: null });
await completeScan(scan.id, { raw, score: report.score, summary: freeSummary(report), pagesDone: raw.pages.length });
const user = await upsertUser("sample@legible.test");
const token = randomBytes(18).toString("base64url");
await createReportOnce({
  scanId: scan.id,
  userId: user.id,
  token,
  stripeSessionId: null,
  amountCents: 0,
  currency: "usd",
});

const browser = await chromium.launch();
try {
  mkdirSync(OUT, { recursive: true });
  // A4 at 96 dpi, in print media: what the PDF shows.
  const tab = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  await tab.emulateMedia({ media: "print", reducedMotion: "reduce" });
  await tab.goto(`${BASE}/report/${token}?print=1`, { waitUntil: "networkidle" });
  await tab.locator(".rp-cover").screenshot({ path: `${OUT}/cover.jpg`, type: "jpeg", quality: 82 });

  // The first must-fix page: only that section, inside the PDF's page margins.
  await tab.addStyleTag({
    content: `.rp-doc > :not([aria-labelledby="g-must"]) { display: none !important; }
      .rp-doc { padding: 16mm 15mm 0 !important; background: #fff; }`,
  });
  await tab.screenshot({
    path: `${OUT}/issue.jpg`,
    type: "jpeg",
    quality: 82,
    clip: { x: 0, y: 0, width: 794, height: 1123 },
  });
  console.log(`Saved ${OUT}/cover.jpg and ${OUT}/issue.jpg (score ${report.score}, ${report.totalIssues} failures).`);
} finally {
  await browser.close();
  const sql = db();
  await sql`delete from reports where scan_id = ${scan.id}`;
  await sql`delete from scans where id = ${scan.id}`;
  await sql`delete from users where email = 'sample@legible.test' and not exists (select 1 from reports where user_id = users.id)`;
  await sql.end();
}
