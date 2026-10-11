import { describe, expect, it } from "vitest";
import { completeSnippet, fixKind, removeAttr, setAttr, suggestFix } from "@/lib/rules/fixes";
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

  it("uses a placeholder that names the field as the label text", () => {
    const wrapped = suggestFix("label", { html: '<input type="email" name="email" placeholder="Email">' });
    expect(wrapped?.code).toBe('<label>\n  Email\n  <input type="email" name="email" placeholder="Email">\n</label>');
    expect(wrapped?.note).toContain("placeholder");
    expect(suggestFix("label", { html: '<input id="q" placeholder="Search products…">' })?.code).toBe(
      '<label for="q">Search products</label>\n<input id="q" placeholder="Search products…">',
    );
    expect(suggestFix("label", { html: '<input placeholder="Your name *">' })?.code).toContain("\n  Your name\n");
    expect(suggestFix("label", { html: '<input placeholder="Address line 1">' })?.code).toContain("\n  Address line 1\n");
    expect(suggestFix("label", { html: '<input placeholder="Fish &amp; chips">' })?.code).toContain("\n  Fish &amp; chips\n");
  });

  it("keeps [Field name] when the placeholder is an example value, not a name", () => {
    for (const placeholder of ["jane@example.com", "e.g. Jane Smith", "Eg: London", "DD/MM/YYYY", "07700 900123", "0.00", "https://", "…", ""]) {
      const fix = suggestFix("label", { html: `<input placeholder="${placeholder}">` });
      expect(fix?.code, placeholder).toContain("[Field name]");
      expect(fix?.note, placeholder).not.toContain("placeholder");
    }
    const long = "Tell us a little about what you would like us to do for you";
    expect(suggestFix("label", { html: `<input placeholder="${long}">` })?.code).toContain("[Field name]");
  });

  it("uses the placeholder for fields named with aria-label too", () => {
    expect(suggestFix("aria-input-field-name", { html: '<div role="searchbox" aria-placeholder="Search recipes" contenteditable="">' })?.code).toBe(
      '<div role="searchbox" aria-placeholder="Search recipes" contenteditable="" aria-label="Search recipes">',
    );
    expect(suggestFix("button-name", { html: '<button role="combobox" placeholder="Choose a size">…</button>' })?.code).toBe(
      '<button role="combobox" placeholder="Choose a size" aria-label="Choose a size">…</button>',
    );
    // A button's name is what it does, never a placeholder.
    expect(suggestFix("button-name", { html: '<button placeholder="Search">…</button>' })?.code).toContain("[What the button does]");
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

  it("names the placeholder after the element's role, not its tag", () => {
    const html = '<button type="button" role="combobox" aria-expanded="false">…</button>';
    expect(suggestFix("button-name", { html })?.code).toBe(
      '<button type="button" role="combobox" aria-expanded="false" aria-label="[Field name]">…</button>',
    );
    expect(suggestFix("button-name", { html: '<button role="switch">…</button>' })?.code).toBe(
      '<button role="switch" aria-label="[What it switches]">…</button>',
    );
    expect(suggestFix("button-name", { html: "<button>…</button>" })?.code).toBe('<button aria-label="[What the button does]">…</button>');
  });

  it("replaces common made-up autocomplete values with the standard ones", () => {
    const fix = (value: string) =>
      suggestFix("autocomplete-valid", { html: `<input type="text" name="x" autocomplete="${value}">` })?.code;
    expect(fix("firstName")).toBe('<input type="text" name="x" autocomplete="given-name">');
    expect(fix("last_name")).toBe('<input type="text" name="x" autocomplete="family-name">');
    expect(fix("phone")).toBe('<input type="text" name="x" autocomplete="tel">');
    expect(fix("zip")).toBe('<input type="text" name="x" autocomplete="postal-code">');
    expect(fix("nope")).toBe('<input type="text" name="x" autocomplete="off">');
    expect(fix("shipping favourite-colour")).toBeUndefined();
  });

  it("returns null when it cannot help", () => {
    expect(suggestFix("nested-interactive", { html: "<button><a href='/'>x</a></button>" })).toBeNull();
    expect(suggestFix("color-contrast", { html: "<p>x</p>", data: null })).toBeNull();
  });
});

describe("completeSnippet", () => {
  it("closes an element recorded as its opening tag only", () => {
    expect(completeSnippet('<select id="size" class="x">')).toBe('<select id="size" class="x">…</select>');
    expect(completeSnippet("<button>")).toBe("<button>…</button>");
  });

  it("leaves complete, void and page-level elements alone", () => {
    expect(completeSnippet('<button aria-label="Close"><svg></svg></button>')).toBe('<button aria-label="Close"><svg></svg></button>');
    expect(completeSnippet('<img src="a.png">')).toBe('<img src="a.png">');
    expect(completeSnippet('<html class="js">')).toBe('<html class="js">');
    expect(completeSnippet('<div class="cut-off-mid-attribute…')).toBe('<div class="cut-off-mid-attribute…');
  });

  it("keeps the label fix readable", () => {
    expect(suggestFix("select-name", { html: completeSnippet('<select class="x">') })?.code).toBe(
      '<label>\n  [Field name]\n  <select class="x">…</select>\n</label>',
    );
  });
});

describe("CSS fixes change only the failing element", () => {
  const contrast = { fgColor: "#41545d", bgColor: "#a9b8bf", contrastRatio: 3.88, expectedContrastRatio: "4.5:1" };

  it("uses the element's full selector, not a bare tag that would restyle the whole site", () => {
    const target = ['tr:nth-child(2) > td[bgcolor="#A9B8BF"] > font[color="#41545D"] > b'];
    const fix = suggestFix("color-contrast", { html: "<b>Free Penguins</b>", target, data: contrast });
    expect(fix?.code).toMatch(/^tr:nth-child\(2\) > td\[bgcolor="#A9B8BF"\] > font\[color="#41545D"\] > b \{\n  color: #[0-9a-f]{6};/);
    const link = suggestFix("link-in-text-block", { html: "<a href='/x'>x</a>", target: ["main > div.content > p:nth-child(3) > a.more"] });
    expect(link?.code).toBe("main > div.content > p:nth-child(3) > a.more {\n  text-decoration: underline;\n}");
  });

  it("writes the rule for the frame the element is in", () => {
    const fix = suggestFix("link-in-text-block", { html: "<a href='/x'>x</a>", target: ["#map", "p > a.more"] });
    expect(fix?.code).toBe("p > a.more {\n  text-decoration: underline;\n}");
  });

  it("changes an inline colour where it is set, because a stylesheet rule would not override it", () => {
    const fix = suggestFix("color-contrast", {
      html: '<span class="tag" style="font-weight: bold; color: #41545d">New</span>',
      target: [".tag"],
      data: contrast,
    });
    expect(fix?.code).toMatch(/^<span class="tag" style="font-weight: bold; color: #[0-9a-f]{6}">New<\/span>$/);
    expect(fix?.code).not.toContain("#41545d");
  });

  it("says so when light text has to become dark, and offers a darker background instead", () => {
    const fix = suggestFix("color-contrast", {
      html: '<a href="/more">Learn More</a>',
      target: ['a[href$="more"]'],
      data: { fgColor: "#ffffff", bgColor: "#36b3a8", contrastRatio: 2.57, expectedContrastRatio: "4.5:1" },
    });
    expect(fix?.note).not.toContain("stays close to the original colour");
    expect(fix?.note).toMatch(/^The text is #ffffff on #36b3a8, a ratio of 2\.57:1\. This needs at least 4\.5:1\. No lighter text colour reaches that on this background, so this uses dark text: #[0-9a-f]{6} gives [\d.]+:1\. To keep the text #ffffff, darken the background to #[0-9a-f]{6} instead\.$/);
    const bg = /background to (#[0-9a-f]{6})/.exec(fix!.note!)![1];
    expect(contrastRatio([255, 255, 255], parseHex(bg)!)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves an inline background colour alone", () => {
    const fix = suggestFix("color-contrast", {
      html: '<span class="tag" style="background-color: #a9b8bf">New</span>',
      target: [".tag"],
      data: contrast,
    });
    expect(fix?.code).toMatch(/^\.tag \{\n  color: #[0-9a-f]{6}; \/\* was #41545d \*\/\n\}$/);
  });
});

describe("fixKind", () => {
  it("tells markup, stylesheet rules and notes apart", () => {
    expect(fixKind('<img src="a.jpg" alt="[Describe the image]">')).toBe("html");
    expect(fixKind("#main > p {\n  color: #595959; /* was #999999 */\n}")).toBe("css");
    expect(fixKind("<!-- Remove this tag. -->")).toBe("note");
  });
});
