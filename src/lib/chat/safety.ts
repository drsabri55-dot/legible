// The last check before an answer is shown or saved. The prompt already
// forbids these claims; this catches the answer that slips through.
export const SAFE_LAW_ANSWER =
  "I can't tell you whether your site meets the law. Legible identifies issues measured against WCAG 2.1 Level AA. Automated testing cannot detect every issue, so manual review is recommended.";

const BANNED = [/\bcomplian(t|ce)\b/i, /\blegally\s+safe\b/i, /\bfully\s+accessible\b/i, /\bguarantee/i, /\blawsuit[- ]proof\b/i, /\bcertified\b/i];

export function safeAnswer(text: string): { text: string; replaced: boolean } {
  return BANNED.some((re) => re.test(text)) ? { text: SAFE_LAW_ANSWER, replaced: true } : { text, replaced: false };
}
