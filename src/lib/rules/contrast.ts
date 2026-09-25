// WCAG 2.1 contrast maths, plus a search for the nearest colour that passes.

export type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance([r, g, b]: RGB): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Moves the foreground towards black or white (whichever gives more room
// against this background) just far enough to reach the target ratio, so the
// suggestion stays as close as possible to the original colour.
export function suggestForeground(fg: RGB, bg: RGB, target: number): RGB | null {
  if (contrastRatio(fg, bg) >= target) return fg;
  const black: RGB = [0, 0, 0];
  const white: RGB = [255, 255, 255];
  const towards = contrastRatio(black, bg) >= contrastRatio(white, bg) ? black : white;
  if (contrastRatio(towards, bg) < target) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mix(fg, towards, mid), bg) >= target) hi = mid;
    else lo = mid;
  }
  // Round, then nudge until the rounded colour really passes.
  let t = hi;
  let candidate = mix(fg, towards, t).map(Math.round) as RGB;
  while (contrastRatio(candidate, bg) < target && t < 1) {
    t = Math.min(1, t + 0.01);
    candidate = mix(fg, towards, t).map(Math.round) as RGB;
  }
  return candidate;
}

export function formatRatio(r: number): string {
  return `${(Math.floor(r * 100) / 100).toFixed(2).replace(/\.?0+$/, "")}:1`;
}
