// Answers are plain text; a Markdown link survives only when it points at an
// anchor on this page. Anything else keeps its words and loses the link.
export type AnswerPart = { text: string } | { text: string; href: string };

export function answerParts(text: string, anchors: Set<string>): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let plain = "";
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]{1,120})\]\(([^)\s]{1,200})\)/g)) {
    plain += text.slice(last, m.index);
    last = m.index! + m[0].length;
    const href = m[2];
    if (href.startsWith("#") && anchors.has(href.slice(1))) {
      if (plain) parts.push({ text: plain });
      plain = "";
      parts.push({ text: m[1], href });
    } else {
      plain += m[1];
    }
  }
  plain += text.slice(last);
  if (plain) parts.push({ text: plain });
  return parts;
}
