// Tries one fix on one element of the page the scan has open: applies it,
// runs the same check that failed, then undoes it, so the next check sees the
// page as it was. Nothing reaches the real site: the change lives only in
// this browser tab. Page scripts are strings (see the note in agent/dom.ts).
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import { SELECTOR_FN } from "../agent/dom";
import {
  FOCUS_REVIEW,
  focusShareAt,
  measureKeyboardReach,
  measureReflow,
  measureTextSpacing,
  trapFrom,
  type Measured,
} from "../agent/measure";
import type { FixKind } from "../types";

// "untestable": the fix could not be tried here (a note, markup that is not
// one element, an element that cannot be found). "unknown": it was tried but
// the check could not decide.
export type Verdict = "pass" | "fail" | "unknown" | "untestable";

export const MAX_FIX_CHARS = 6000;
const TRY_MS = 15_000;
const MARK = "data-legible-fix-el";

export interface FixTry {
  ruleId: string;
  // The failing element's selector in the page (no frames).
  selector: string;
  // Its code as the scan recorded it, for working out what a fix changes.
  html: string;
  fix: { code: string; kind: FixKind };
  // Replace the whole element with the fix (AI fixes). Otherwise the fix is
  // compared with `html` and only what differs is applied.
  replace?: boolean;
}

// With `dry`, only checks that the fix can be applied and changes nothing.
const APPLY = (t: FixTry, dry = false) => `(function (inp) {
  var MARK = ${JSON.stringify(MARK)};
  var list;
  try { list = document.querySelectorAll(inp.selector); } catch (e) { return 'untestable'; }
  if (list.length !== 1) return 'untestable';
  // Never over another fix that is still on the page.
  if ((window.__legibleUndo || []).length || document.querySelector('[' + MARK + ']')) return 'untestable';
  var el = list[0];
  var undo = [];
  // Parsed elements. <html>, <head> and <body> only survive a full document parse.
  function parse(code) {
    var m = /^\\s*<([a-zA-Z][^\\s\\/>]*)/.exec(code || '');
    var tag = m ? m[1].toLowerCase() : '';
    if (tag === 'html' || tag === 'head' || tag === 'body') {
      var doc = new DOMParser().parseFromString(code, 'text/html');
      return [tag === 'html' ? doc.documentElement : tag === 'head' ? doc.head : doc.body];
    }
    var t = document.createElement('template');
    t.innerHTML = String(code || '').trim();
    // Words around the markup are not code: such a fix cannot be shown as tested.
    var prose = Array.prototype.some.call(t.content.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
    return prose ? null : Array.prototype.slice.call(t.content.children);
  }
  // Markup from a fix must never run code in the page. Markup that would,
  // is refused rather than cleaned, so what is shown is exactly what was tested.
  var UNSAFE_TAGS = 'script, style, iframe, object, embed, meta, base, link';
  function unsafeAttr(name, value) { return /^on/i.test(name) || /^\\s*javascript:/i.test(value || ''); }
  function safe(node) {
    if (node.matches(UNSAFE_TAGS) || node.querySelector(UNSAFE_TAGS)) return false;
    return [node].concat(Array.prototype.slice.call(node.querySelectorAll('*'))).every(function (e) {
      return Array.prototype.every.call(e.attributes, function (a) { return !unsafeAttr(a.name, a.value); });
    });
  }
  if (inp.fix.kind === 'css') {
    if (inp.dry) return 'ok';
    var st = document.createElement('style');
    st.setAttribute('data-legible-fix', '');
    st.textContent = inp.fix.code;
    (document.head || document.documentElement).appendChild(st);
    undo.push(function () { st.remove(); });
    el.setAttribute(MARK, '');
  } else if (inp.fix.kind === 'html' && inp.replace) {
    var kids = parse(inp.fix.code);
    // One element, of the same kind as the one it replaces.
    if (inp.fix.code.length > ${MAX_FIX_CHARS} || !kids || kids.length !== 1) return 'untestable';
    if (kids[0].tagName !== el.tagName || ['HTML', 'HEAD', 'BODY'].indexOf(el.tagName) >= 0 || !safe(kids[0])) return 'untestable';
    if (inp.dry) return 'ok';
    var neu = document.importNode(kids[0], true);
    el.replaceWith(neu);
    neu.setAttribute(MARK, '');
    undo.push(function () { neu.replaceWith(el); });
  } else if (inp.fix.kind === 'html') {
    var fixed = parse(inp.fix.code), orig = parse(inp.html);
    if (!fixed || !orig || orig.length !== 1) return 'untestable';
    var tag = el.tagName.toLowerCase();
    if (orig[0].tagName.toLowerCase() !== tag) return 'untestable';
    if (fixed.length === 2 && fixed[0].tagName.toLowerCase() === 'label' && fixed[1].tagName.toLowerCase() === tag) {
      // A label added before the field.
      if (!safe(fixed[0])) return 'untestable';
      if (inp.dry) return 'ok';
      var label = document.importNode(fixed[0], true);
      el.parentNode.insertBefore(label, el);
      undo.push(function () { label.remove(); });
    } else if (fixed.length === 1 && fixed[0].tagName.toLowerCase() === tag) {
      // The same element with changed attributes: apply only the differences,
      // so attributes the scan did not record are left alone.
      var f = fixed[0], o = orig[0];
      var names = {};
      Array.prototype.forEach.call(f.attributes, function (a) { names[a.name] = 1; });
      Array.prototype.forEach.call(o.attributes, function (a) { names[a.name] = 1; });
      var changed = Object.keys(names).filter(function (n) { return f.getAttribute(n) !== o.getAttribute(n); });
      // A fix that changes nothing on the element proves nothing.
      if (!changed.length || changed.some(function (n) { return unsafeAttr(n, f.getAttribute(n)); })) return 'untestable';
      if (inp.dry) return 'ok';
      changed.forEach(function (n) {
        var want = f.getAttribute(n);
        var live = el.getAttribute(n);
        if (want === null) el.removeAttribute(n); else el.setAttribute(n, want);
        undo.push(function () { if (live === null) el.removeAttribute(n); else el.setAttribute(n, live); });
      });
    } else {
      return 'untestable';
    }
    el.setAttribute(MARK, '');
  } else {
    return 'untestable';
  }
  window.__legibleUndo = undo;
  return 'applied';
})(${JSON.stringify({ ...t, dry })})`;

const UNDO = `(function () {
  var undo = window.__legibleUndo || [];
  for (var i = undo.length - 1; i >= 0; i--) { try { undo[i](); } catch (e) {} }
  window.__legibleUndo = [];
  document.querySelectorAll('[${MARK}]').forEach(function (e) { e.removeAttribute('${MARK}'); });
  document.querySelectorAll('style[data-legible-fix]').forEach(function (e) { e.remove(); });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
})()`;

const MARKED_SELECTOR = `(function () {
  ${SELECTOR_FN}
  var e = document.querySelector('[${MARK}]');
  return e ? __sel(e) : null;
})()`;

// Whether a finding is the marked element, holds it or sits inside it.
const TOUCHES_MARKED = (selectors: string[]) => `(function (sels) {
  var m = document.querySelector('[${MARK}]');
  if (!m) return true;
  return sels.some(function (s) {
    var e;
    try { e = document.querySelector(s); } catch (x) { return false; }
    return !!e && (e === m || e.contains(m) || m.contains(e));
  });
})(${JSON.stringify(selectors)})`;

const MEASURED = new Set(["legible-focus-visible", "legible-keyboard-trap", "legible-reflow", "legible-text-spacing", "legible-keyboard-reach"]);

async function pageFindings(page: Page, ruleId: string): Promise<Measured[]> {
  if (ruleId === "legible-reflow") return measureReflow(page);
  if (ruleId === "legible-text-spacing") return measureTextSpacing(page);
  return measureKeyboardReach(page, []);
}

async function touchesMarked(page: Page, found: Measured[]): Promise<boolean> {
  return (await page.evaluate(TOUCHES_MARKED(found.map((m) => m.selector)))) as boolean;
}

// Rules about what the page's own scripts do. A replaced element is a fresh
// copy without those scripts, so replacing it would always look like a fix.
const BEHAVIOUR = new Set(["legible-keyboard-trap", "legible-keyboard-reach"]);

// Marks the failing element on its own (no change), for the axe check before the fix.
const MARK_ONLY = (selector: string) => `(function (sel) {
  var list;
  try { list = document.querySelectorAll(sel); } catch (e) { return false; }
  if (list.length !== 1 || document.querySelector('[${MARK}]')) return false;
  list[0].setAttribute('${MARK}', '');
  return true;
})(${JSON.stringify(selector)})`;
const UNMARK = `document.querySelectorAll('[${MARK}]').forEach(function (e) { e.removeAttribute('${MARK}'); })`;

// One axe rule on the marked element only. "fail": the rule fails there;
// "pass": it applies there and passes; anything else is "unknown".
async function axeOnMarked(page: Page, ruleId: string): Promise<Verdict> {
  const res = await new AxeBuilder({ page })
    .include(`[${MARK}]`)
    .options({ runOnly: { type: "rule", values: [ruleId] }, resultTypes: ["violations", "incomplete"] })
    .analyze();
  if (res.violations.some((v) => v.id === ruleId)) return "fail";
  if (res.incomplete.some((v) => v.id === ruleId)) return "unknown";
  return res.passes.some((v) => v.id === ruleId) ? "pass" : "unknown";
}

// The check before the fix: a fix can only be shown to work where the
// failure can be seen first, on this element, now.
async function baseline(page: Page, t: FixTry): Promise<boolean> {
  if (t.ruleId === "legible-focus-visible") {
    const share = await focusShareAt(page, t.selector);
    return share !== null && share < FOCUS_REVIEW;
  }
  if (t.ruleId === "legible-keyboard-trap") return !!(await trapFrom(page, t.selector));
  if (MEASURED.has(t.ruleId)) {
    const found = await pageFindings(page, t.ruleId);
    return found.some((m) => m.selector === t.selector);
  }
  if (!(await page.evaluate(MARK_ONLY(t.selector)))) return false;
  try {
    return (await axeOnMarked(page, t.ruleId)) === "fail";
  } finally {
    await page.evaluate(UNMARK);
  }
}

async function recheck(page: Page, ruleId: string): Promise<Verdict> {
  if (ruleId === "legible-focus-visible" || ruleId === "legible-keyboard-trap") {
    const sel = (await page.evaluate(MARKED_SELECTOR)) as string | null;
    if (!sel) return "unknown";
    if (ruleId === "legible-focus-visible") {
      // A pass needs a measured, visible change; "could not measure" is not one.
      const share = await focusShareAt(page, sel);
      if (share === null) return "unknown";
      return share >= FOCUS_REVIEW ? "pass" : "fail";
    }
    const focusable = await page.evaluate(
      `(function () { var e = document.querySelector('[${MARK}]'); if (!e) return false; e.focus(); return document.activeElement === e; })()`,
    );
    if (!focusable) return "unknown";
    return (await trapFrom(page, sel)) ? "fail" : "pass";
  }
  if (MEASURED.has(ruleId)) {
    return (await touchesMarked(page, await pageFindings(page, ruleId))) ? "fail" : "pass";
  }
  return axeOnMarked(page, ruleId);
}

function bounded<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function tryFix(page: Page, t: FixTry): Promise<Verdict> {
  if (t.fix.kind === "note" || t.fix.code.length > MAX_FIX_CHARS || !t.selector) return "untestable";
  if (t.replace && BEHAVIOUR.has(t.ruleId)) return "untestable";
  // Set when the time runs out, so late work never changes the page after the undo.
  let stopped = false;
  const work = (async (): Promise<Verdict> => {
    // A fix that cannot be applied is refused before anything else.
    if ((await page.evaluate(APPLY(t, true))) !== "ok") return "untestable";
    if (!(await baseline(page, t))) return "unknown";
    if (stopped) return "unknown";
    const applied = (await page.evaluate(APPLY(t))) as string;
    if (applied !== "applied") return "untestable";
    return recheck(page, t.ruleId);
  })();
  try {
    return await bounded(work, TRY_MS, "unknown" as Verdict);
  } finally {
    stopped = true;
    // Let a check that is still running finish before undoing, within limits.
    await bounded(work, 5000, "unknown" as Verdict);
    await bounded(page.evaluate(UNDO), 5000, undefined);
  }
}
