import { describe, expect, it } from "vitest";
import { removeAttr, setAttr, suggestFix } from "@/lib/rules/fixes";
import { contrastRatio, parseHex } from "@/lib/rules/contrast";

describe("attribute editing", () => {
  it("adds, replaces and removes attributes on the first tag only", () => {
    expect(setAttr('<img src="a.png">', "alt", "x")).toBe('<img src="a.png" alt="x">');
    expect(setAttr('<img src="a.png" alt="">', "alt", "x")).toBe('<img src="a.png" alt="x">');
    expect(setAttr('<img src="a.png"/>', "alt", "x")).toBe('<img src="a.png" alt="x"/>');
    expect(setAttr('<a href="/"><img src="i.png"></a>', "aria-label", "Home")).toBe(
      '<a href="/" aria-label="Home"><img src="i.png"></a>',
    );
    expect(removeAttr('<iframe src="/b" tabindex="-1" title="B">', "tabindex")).toBe('<iframe src="/b" title="B">');
    expect(setAttr('<img src="a.png" alt="$&">', "alt", "$1")).toBe('<img src="a.png" alt="$1">');
  });

  it("refuses snippets it cannot parse", () => {
    expect(setAttr('<img src="very-long-truncated…', "alt", "x")).toBeNull();
    expect(setAttr("plain text", "alt", "x")).toBeNull();
  });
});

describe("suggestFix", () => {
  it("adds alt text placeholders to images", () => {
    expect(suggestFix("image-alt", { html: '<img src="/team.jpg">' })?.code).toBe(
      '<img src="/team.jpg" alt="[Describe the image]">',
    );
  });

  it("labels fields, using the id when there is one", () => {
    expect(suggestFix("label", { html: '<input id="email" type="email">' })?.code).toBe(
      '<label for="email">[Field name]</label>\n<input id="email" type="email">',
    );
    expect(suggestFix("label", { html: '<input type="email">' })?.code).toContain("<label>");
  });

  it("sets the page language", () => {
    expect(suggestFix("html-has-lang", { html: "<html>" })?.code).toBe('<html lang="en">');
  });

  it("re-enables zoom", () => {
    expect(
      suggestFix("meta-viewport", {
        html: '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
      })?.code,
    ).toBe('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  it("removes the ARIA attributes axe names", () => {
    expect(
      suggestFix("aria-allowed-attr", {
        html: '<a class="t" aria-level="2" href="/v">Video</a>',
        failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-level="2"',
      })?.code,
    ).toBe('<a class="t" href="/v">Video</a>');
  });

  it("suggests a passing text colour for contrast failures", () => {
    const fix = suggestFix("color-contrast", {
      html: '<span class="price">$20</span>',
      target: [".price"],
      data: { fgColor: "#9a9a9a", bgColor: "#ffffff", contrastRatio: 2.8, expectedContrastRatio: "4.5:1" },
    });
    expect(fix?.code).toMatch(/^\.price \{\n  color: #[0-9a-f]{6}; \/\* was #9a9a9a \*\/\n\}$/);
    const hex = /color: (#[0-9a-f]{6})/.exec(fix!.code)![1];
    expect(contrastRatio(parseHex(hex)!, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(fix?.note).toContain("a ratio of 2.81:1");
  });

  it("returns null when it cannot help", () => {
    expect(suggestFix("nested-interactive", { html: "<button><a href='/'>x</a></button>" })).toBeNull();
    expect(suggestFix("color-contrast", { html: "<p>x</p>", data: null })).toBeNull();
  });
});
