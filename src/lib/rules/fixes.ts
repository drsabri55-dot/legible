// Turns a failing element from the site into a corrected version of the same
// element. Placeholders in [square brackets] are text only the site owner can
// write, such as what an image shows. When a fix cannot be worked out safely,
// return null and the report falls back to the generic example.

import { contrastRatio, formatRatio, luminance, parseHex, suggestForeground, toHex } from "./contrast";

export interface NodeData {
  html: string;
  target?: string[];
  failureSummary?: string;
  data?: Record<string, unknown> | null;
}

// axe names the offending attributes in its summary, for example
// "ARIA attribute is not allowed: aria-level=\"2\"".
function ariaAttrsIn(summary: string | undefined): string[] {
  if (!summary) return [];
  const names = new Set<string>();
  for (const m of summary.matchAll(/\b(aria-[a-z]+)\b/g)) names.add(m[1]);
  return [...names];
}

function removeAttrs(html: string, names: string[]): string | null {
  let out: string | null = html;
  for (const name of names) {
    if (!out) return null;
    out = removeAttr(out, name);
  }
  return out && out !== html ? out : null;
}

export interface SuggestedFix {
  code: string;
  note?: string;
}

const TAG = /^(\s*<[a-zA-Z][^\s/>]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)(\s*\/?>)/;

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

// axe records only the opening tag of an element with long contents. Shown
// alone, "<select …>" reads as broken code, so the omitted contents are
// marked "…" and the element is closed.
export function completeSnippet(html: string): string {
  const trimmed = html.trim();
  const m = TAG.exec(trimmed);
  if (!m || m[0].length !== trimmed.length || /\/>$/.test(trimmed)) return html;
  const name = /^\s*<([a-zA-Z][^\s/>]*)/.exec(trimmed)![1].toLowerCase();
  if (VOID_ELEMENTS.has(name) || name === "html" || name === "body" || name === "head") return html;
  return `${trimmed}…</${name}>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function openingTag(html: string): RegExpExecArray | null {
  return TAG.exec(html);
}

function tagName(html: string): string | null {
  const m = /^\s*<([a-zA-Z][^\s/>]*)/.exec(html);
  return m ? m[1].toLowerCase() : null;
}

function attrPattern(name: string): RegExp {
  return new RegExp(`\\s${name.replace(/[-:]/g, "\\$&")}(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+))?(?=[\\s/>]|$)`, "i");
}

function getAttr(html: string, name: string): string | null {
  const m = openingTag(html);
  if (!m) return null;
  const a = attrPattern(name).exec(m[2]);
  if (!a) return null;
  return (a[2] || "").replace(/^["']|["']$/g, "");
}

// Sets (or replaces) one attribute on the first tag of the snippet.
export function setAttr(html: string, name: string, value: string | null): string | null {
  const m = openingTag(html);
  if (!m) return null;
  const attrs = m[2];
  const next = value === null ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`;
  const pattern = attrPattern(name);
  const newAttrs = pattern.test(attrs) ? attrs.replace(pattern, () => next) : attrs + next;
  return m[1] + newAttrs + m[3] + html.slice(m[0].length);
}

export function removeAttr(html: string, name: string): string | null {
  const m = openingTag(html);
  if (!m) return null;
  return m[1] + m[2].replace(attrPattern(name), "") + m[3] + html.slice(m[0].length);
}

function withLabel(html: string): SuggestedFix | null {
  const id = getAttr(html, "id");
  if (id) {
    return { code: `<label for="${escapeAttr(id)}">[Field name]</label>\n${html}` };
  }
  if (!openingTag(html)) return null;
  return {
    code: `<label>\n  [Field name]\n  ${html}\n</label>`,
    note: "Wrapping the field in its label connects the two. A label with a for attribute that matches the field's id works too.",
  };
}

// The element's selector inside its own document (the last frame level). axe
// builds it as the shortest selector that matches only this element, so a
// rule written against it changes the failing element and nothing else. Its
// last step alone ("b") could restyle every bold word on the site.
function ownSelector(target: string[] | undefined, fallback: string): string {
  return target?.[target.length - 1] || fallback;
}

// A color declaration in a style attribute, not background-color.
const INLINE_COLOR = /(^|;)(\s*)color\s*:[^;]*/i;

function contrastFix(node: NodeData): SuggestedFix | null {
  const d = node.data || {};
  const fg = typeof d.fgColor === "string" ? parseHex(d.fgColor) : null;
  const bg = typeof d.bgColor === "string" ? parseHex(d.bgColor) : null;
  const expected = typeof d.expectedContrastRatio === "string" ? parseFloat(d.expectedContrastRatio) : NaN;
  if (!fg || !bg || !Number.isFinite(expected)) return null;
  // Aim a hair above the minimum so rounding in browsers cannot tip it under.
  const next = suggestForeground(fg, bg, expected + 0.05);
  if (!next) return null;
  const before = contrastRatio(fg, bg);
  const after = contrastRatio(next, bg);
  const start = `The text is ${toHex(fg)} on ${toHex(bg)}, a ratio of ${formatRatio(before)}. This needs at least ${formatRatio(expected)}.`;
  // When only the opposite kind of colour passes (light text on a mid-tone
  // background that needs dark text), the suggestion is no longer close to
  // the original, so the note says so and gives the background that would
  // keep the original text colour.
  const flipped = luminance(fg) > luminance(bg) !== luminance(next) > luminance(bg);
  const newBg = flipped ? suggestForeground(bg, fg, expected + 0.05) : null;
  const note = flipped
    ? `${start} No ${luminance(fg) > luminance(bg) ? "lighter" : "darker"} text colour reaches that on this background, so this uses ${luminance(next) > luminance(bg) ? "light" : "dark"} text: ${toHex(next)} gives ${formatRatio(after)}.${newBg ? ` To keep the text ${toHex(fg)}, ${luminance(newBg) < luminance(bg) ? "darken" : "lighten"} the background to ${toHex(newBg)} instead.` : ""}`
    : `${start} ${toHex(next)} gives ${formatRatio(after)} and stays close to the original colour. Changing the background works too.`;
  // A colour set in the element's style attribute beats any stylesheet rule,
  // so it has to change where it is written.
  const style = getAttr(node.html, "style");
  if (style !== null && INLINE_COLOR.test(style)) {
    const code = setAttr(node.html, "style", style.replace(INLINE_COLOR, `$1$2color: ${toHex(next)}`));
    if (code) return { code, note };
  }
  const selector = ownSelector(node.target, "selector");
  return { code: `${selector} {\n  color: ${toHex(next)}; /* was ${toHex(fg)} */\n}`, note };
}

function viewportFix(html: string): SuggestedFix | null {
  const content = getAttr(html, "content");
  if (content === null) return null;
  const kept = content
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/^(maximum-scale|user-scalable)\s*=/i.test(p));
  const code = setAttr(html, "content", kept.join(", "));
  return code ? { code } : null;
}

// Made-up autocomplete values seen on real sites, keyed by their letters and
// digits only ("first_name" and "firstName" are both "firstname"), and the
// standard token browsers understand.
const AUTOCOMPLETE: Record<string, string> = {
  firstname: "given-name",
  forename: "given-name",
  fname: "given-name",
  givenname: "given-name",
  middlename: "additional-name",
  lastname: "family-name",
  surname: "family-name",
  lname: "family-name",
  familyname: "family-name",
  fullname: "name",
  yourname: "name",
  mail: "email",
  emailaddress: "email",
  phone: "tel",
  telephone: "tel",
  phonenumber: "tel",
  mobile: "tel",
  mobilenumber: "tel",
  zip: "postal-code",
  zipcode: "postal-code",
  postcode: "postal-code",
  postalcode: "postal-code",
  address: "street-address",
  address1: "address-line1",
  addressline1: "address-line1",
  address2: "address-line2",
  addressline2: "address-line2",
  city: "address-level2",
  town: "address-level2",
  state: "address-level1",
  county: "address-level1",
  province: "address-level1",
  company: "organization",
  companyname: "organization",
  jobtitle: "organization-title",
  birthday: "bday",
  dob: "bday",
  dateofbirth: "bday",
  website: "url",
  password: "current-password",
  // Values invented to stop autofill; "off" is the one browsers know.
  nope: "off",
  none: "off",
  false: "off",
  disabled: "off",
  disable: "off",
  no: "off",
};

function autocompleteFix(html: string): SuggestedFix | null {
  const value = getAttr(html, "autocomplete");
  if (!value || /\s/.test(value.trim())) return null;
  const token = AUTOCOMPLETE[value.toLowerCase().replace(/[^a-z0-9]/g, "")];
  const code = token ? setAttr(html, "autocomplete", token) : null;
  return code ? { code } : null;
}

const LABEL_BY_RULE: Record<string, string> = {
  "aria-command-name": "[What it does]",
  "aria-toggle-field-name": "[What it switches]",
  "aria-input-field-name": "[Field name]",
  "aria-meter-name": "[What it measures]",
  "aria-progressbar-name": "[What is loading]",
  "aria-tab-name": "[Tab name]",
  "svg-img-alt": "[Describe the image]",
  "role-img-alt": "[Describe the image]",
  "object-alt": "[Describe the content]",
  "link-name": "[Where the link goes]",
  "button-name": "[What the button does]",
};

// An element whose role makes it something else (a <button> acting as a
// drop-down, say) needs a name that fits that role.
const LABEL_BY_ROLE: Record<string, string> = {
  combobox: "[Field name]",
  listbox: "[Field name]",
  textbox: "[Field name]",
  searchbox: "[Field name]",
  switch: "[What it switches]",
  checkbox: "[What it switches]",
  radio: "[Option name]",
  tab: "[Tab name]",
  link: "[Where the link goes]",
  menuitem: "[What it does]",
};

export function suggestFix(ruleId: string, node: NodeData): SuggestedFix | null {
  const html = node.html || "";
  const tag = tagName(html);
  const wrap = (code: string | null, note?: string): SuggestedFix | null => (code ? { code, note } : null);

  switch (ruleId) {
    case "image-alt":
      return wrap(
        setAttr(html, "alt", "[Describe the image]"),
        'If the image is only decoration, use alt="" instead so screen readers skip it.',
      );
    case "input-image-alt":
      return wrap(setAttr(html, "alt", "[What the button does]"));
    case "area-alt":
      return wrap(setAttr(html, "alt", "[Where the link goes]"));
    case "input-button-name":
      return wrap(setAttr(html, "value", "[Button text]"));
    case "button-name":
    case "link-name":
    case "aria-command-name":
    case "aria-toggle-field-name":
    case "aria-input-field-name":
    case "aria-meter-name":
    case "aria-progressbar-name":
    case "aria-tab-name":
    case "svg-img-alt":
    case "role-img-alt":
    case "object-alt": {
      const note =
        ruleId === "button-name" || ruleId === "link-name"
          ? "Visible text inside the element is even better, because everyone can see it."
          : undefined;
      if (ruleId === "role-img-alt" && tag === "img") return wrap(setAttr(html, "alt", "[Describe the image]"));
      const role = getAttr(html, "role")?.trim().split(/\s+/)[0].toLowerCase() ?? "";
      return wrap(setAttr(html, "aria-label", LABEL_BY_ROLE[role] ?? LABEL_BY_RULE[ruleId]), note);
    }
    case "label":
    case "select-name":
      return withLabel(html);
    case "html-has-lang":
      return wrap(setAttr(html, "lang", "en"), "Use your page's language code if it is not English, for example de, fr or es.");
    case "html-lang-valid":
      return wrap(setAttr(html, "lang", "en"), "Use your page's language code if it is not English, for example de, fr or es.");
    case "html-xml-lang-mismatch": {
      const lang = getAttr(html, "lang");
      return lang ? wrap(setAttr(html, "xml:lang", lang)) : null;
    }
    case "document-title":
      return {
        code: "<head>\n  …\n  <title>[Page name] · [Site name]</title>\n</head>",
        note: "Each page needs its own title, describing that page.",
      };
    case "frame-title":
      return wrap(setAttr(html, "title", "[What the frame shows]"));
    case "frame-focusable-content":
      return wrap(removeAttr(html, "tabindex"));
    case "aria-hidden-focus":
      return wrap(setAttr(html, "inert", null), "inert removes everything inside from the tab order as well as hiding it.");
    case "aria-hidden-body":
      return wrap(removeAttr(html, "aria-hidden"));
    case "aria-allowed-attr":
    case "aria-prohibited-attr":
    case "aria-conditional-attr":
      return wrap(
        removeAttrs(html, ariaAttrsIn(node.failureSummary)),
        ruleId === "aria-prohibited-attr"
          ? "If the label carries information people need, put it in visible text instead."
          : undefined,
      );
    case "aria-roles":
      return wrap(removeAttr(html, "role"), "Or replace it with a valid role. A native HTML element is usually better still.");
    case "scrollable-region-focusable": {
      const step1 = setAttr(html, "tabindex", "0");
      const step2 = step1 && setAttr(step1, "role", "region");
      return wrap(step2 && setAttr(step2, "aria-label", "[What this area contains]"));
    }
    case "meta-viewport":
      return viewportFix(html);
    case "autocomplete-valid":
      return autocompleteFix(html);
    case "meta-refresh":
      return {
        code: "<!-- Remove this tag. If the page has moved, redirect on the server with HTTP 301. -->",
      };
    case "color-contrast":
      return contrastFix(node);
    case "link-in-text-block": {
      const selector = ownSelector(node.target, "a");
      return { code: `${selector} {\n  text-decoration: underline;\n}` };
    }
    case "no-autoplay-audio": {
      const muted = setAttr(html, "muted", null);
      return wrap(muted && setAttr(muted, "controls", null));
    }
    case "blink":
    case "marquee": {
      const inner = html.replace(/^\s*<(blink|marquee)[^>]*>/i, "").replace(/<\/(blink|marquee)>\s*$/i, "");
      return inner !== html ? { code: `<span>${inner}</span>` } : null;
    }
    default:
      return null;
  }
}
