import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const TEMPLATES = [
  "sign-in",
  "free-result",
  "report-ready",
  "monitoring-offer",
  "monitoring-result",
  "owner-alert",
] as const;
export type TemplateName = (typeof TEMPLATES)[number];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fill(template: string, vars: Record<string, string | number>, escape: boolean): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Email template needs a value for {{${key}}}`);
    const value = String(vars[key]);
    return escape ? escapeHtml(value) : value;
  });
}

export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|tr|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function renderEmail(name: TemplateName, vars: Record<string, string | number>): Promise<RenderedEmail> {
  const file = path.join(process.cwd(), "emails", `${name}.html`);
  const source = await readFile(file, "utf8");
  const m = /^\s*<!--\s*subject:\s*(.+?)\s*-->/.exec(source);
  if (!m) throw new Error(`${name}.html must start with <!-- subject: ... -->`);
  const subject = fill(m[1], vars, false);
  const html = fill(source.slice(m[0].length).trimStart(), vars, true);
  return { subject, html, text: htmlToText(html) };
}
