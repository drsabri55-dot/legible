import { describe, expect, it } from "vitest";
import { contrastRatio, formatRatio, parseHex, suggestForeground, toHex } from "@/lib/rules/contrast";

describe("contrast", () => {
  it("matches known WCAG ratios", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#767676")!, parseHex("#fff")!)).toBeCloseTo(4.54, 2);
    expect(contrastRatio(parseHex("#777777")!, parseHex("#ffffff")!)).toBeLessThan(4.5);
  });

  it("suggests the nearest colour that passes, in both directions", () => {
    for (const [fg, bg, target] of [
      ["#9a9a9a", "#ffffff", 4.55],
      ["#e0e0e0", "#ffffff", 3.05],
      ["#4a4a6a", "#161826", 4.55],
      ["#ff6666", "#ffeeee", 4.55],
    ] as const) {
      const next = suggestForeground(parseHex(fg)!, parseHex(bg)!, target)!;
      expect(next).not.toBeNull();
      expect(contrastRatio(next, parseHex(bg)!)).toBeGreaterThanOrEqual(target);
      expect(toHex(next)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("leaves passing colours alone", () => {
    expect(suggestForeground([0, 0, 0], [255, 255, 255], 4.5)).toEqual([0, 0, 0]);
  });

  it("never rounds a failing ratio up to a passing one", () => {
    expect(formatRatio(4.499)).toBe("4.49:1");
    expect(formatRatio(4.5)).toBe("4.5:1");
    expect(formatRatio(21)).toBe("21:1");
  });
});
