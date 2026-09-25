import type { RawPage, RawRule, RawScan } from "@/types/scan";

export function rule(id: string, impact: string, nodes: string[], tags: string[] = ["wcag2a", "wcag111"]): RawRule {
  return {
    id,
    impact,
    help: `${id} help`,
    description: `${id} description`,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
    tags,
    nodeCount: nodes.length,
    nodes: nodes.map((html, i) => ({ html, target: [`#el-${id}-${i}`], impact })),
  };
}

export function page(url: string, violations: RawRule[], passes: string[], extra: Partial<RawPage> = {}): RawPage {
  return {
    url,
    status: "scanned",
    title: "A page",
    violations,
    incomplete: [],
    passes: passes.map((id) => ({ id, nodeCount: 3 })),
    inapplicable: [],
    ...extra,
  };
}

export function rawScan(pages: RawPage[]): RawScan {
  return {
    version: 1,
    startUrl: "https://www.shop.example/",
    finalUrl: "https://www.shop.example/",
    engine: { axe: "4.13.0", userAgent: "LegibleBot/1.0" },
    startedAt: "2026-09-25T10:00:00.000Z",
    finishedAt: "2026-09-25T10:00:30.000Z",
    pages,
  };
}

// Two pages: images without alt (critical, 3 + 1), low contrast (serious, 2),
// one moderate issue; passes for a handful of other rules.
export function sampleScan(): RawScan {
  return rawScan([
    page(
      "https://www.shop.example/",
      [
        rule("image-alt", "critical", ['<img src="a.jpg">', '<img src="b.jpg">', '<img src="c.jpg">']),
        rule("color-contrast", "serious", ["<p>x</p>", "<p>y</p>"], ["wcag2aa", "wcag143"]),
      ],
      ["html-has-lang", "document-title", "label", "button-name"],
      { incomplete: [rule("color-contrast", "serious", ["<h1>over image</h1>"], ["wcag2aa", "wcag143"])] },
    ),
    page(
      "https://www.shop.example/about",
      [
        rule("image-alt", "critical", ['<img src="d.jpg">']),
        rule("form-field-multiple-labels", "moderate", ['<input id="pc">'], ["wcag2a", "wcag332"]),
      ],
      ["html-has-lang", "document-title", "link-name"],
    ),
    { ...page("https://www.shop.example/private", [], []), status: "skipped", reason: "robots" },
  ]);
}
