import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

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

export async function waitForEmail(to: string, template: string): Promise<OutboxEmail> {
  let found: OutboxEmail | undefined;
  await expect
    .poll(async () => {
      found = (await outbox(to, template))[0];
      return !!found;
    }, { timeout: 30_000 })
    .toBe(true);
  return found!;
}

export function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@legible.test`;
}
