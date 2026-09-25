// WCAG 2.1 success criteria referenced by the automated checks. Names are the
// official W3C titles, so they keep W3C spelling.

export type Level = "A" | "AA" | "AAA";

export const WCAG: Record<string, { name: string; level: Level; version: "2.0" | "2.1" }> = {
  "1.1.1": { name: "Non-text Content", level: "A", version: "2.0" },
  "1.2.1": { name: "Audio-only and Video-only (Prerecorded)", level: "A", version: "2.0" },
  "1.2.2": { name: "Captions (Prerecorded)", level: "A", version: "2.0" },
  "1.3.1": { name: "Info and Relationships", level: "A", version: "2.0" },
  "1.3.4": { name: "Orientation", level: "AA", version: "2.1" },
  "1.3.5": { name: "Identify Input Purpose", level: "AA", version: "2.1" },
  "1.4.1": { name: "Use of Color", level: "A", version: "2.0" },
  "1.4.2": { name: "Audio Control", level: "A", version: "2.0" },
  "1.4.3": { name: "Contrast (Minimum)", level: "AA", version: "2.0" },
  "1.4.4": { name: "Resize Text", level: "AA", version: "2.0" },
  "1.4.12": { name: "Text Spacing", level: "AA", version: "2.1" },
  "2.1.1": { name: "Keyboard", level: "A", version: "2.0" },
  "2.2.1": { name: "Timing Adjustable", level: "A", version: "2.0" },
  "2.2.2": { name: "Pause, Stop, Hide", level: "A", version: "2.0" },
  "2.4.1": { name: "Bypass Blocks", level: "A", version: "2.0" },
  "2.4.2": { name: "Page Titled", level: "A", version: "2.0" },
  "2.4.4": { name: "Link Purpose (In Context)", level: "A", version: "2.0" },
  "2.5.3": { name: "Label in Name", level: "A", version: "2.1" },
  "3.1.1": { name: "Language of Page", level: "A", version: "2.0" },
  "3.1.2": { name: "Language of Parts", level: "AA", version: "2.0" },
  "3.3.2": { name: "Labels or Instructions", level: "A", version: "2.0" },
  "4.1.2": { name: "Name, Role, Value", level: "A", version: "2.0" },
};

// axe-core tags criteria as "wcag111", "wcag1412" and so on.
export function criteriaFromTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
    if (!m) continue;
    const sc = `${m[1]}.${m[2]}.${m[3]}`;
    if (WCAG[sc] && WCAG[sc].level !== "AAA" && !out.includes(sc)) out.push(sc);
  }
  return out;
}

export function understandingUrl(sc: string): string {
  const name = WCAG[sc]?.name;
  if (!name) return "https://www.w3.org/WAI/WCAG21/Understanding/";
  const slug = name
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "-");
  return `https://www.w3.org/WAI/WCAG21/Understanding/${slug}.html`;
}
