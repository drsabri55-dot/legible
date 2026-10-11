// Tries one fix on one element of the page the scan has open: applies it,
// runs the same check that failed, then undoes it, so the next check sees the
// page as it was. Nothing reaches the real site: the change lives only in
// this browser tab. Page scripts are strings (see the note in agent/dom.ts).
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import { SELECTOR_FN } from "../agent/dom";
import {
  measureFocusAt,
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

const APPLY = (t: FixTry) => `(function (inp) {
  var MARK = ${JSON.stringify(MARK)};
  var list;
  try { list = document.querySelectorAll(inp.selector); } catch (e) { return 'untestable'; }
  if (list.length !== 1) return 'untestable';
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
    return Array.prototype.slice.call(t.content.children);
  }
  // Markup from a fix never runs code in the page: no scripts, no handlers.
  function clean(node) {
    node.querySelectorAll('script, iframe, object, embed').forEach(function (e) { e.remove(); });
    [node].concat(Array.prototype.slice.call(node.querySelectorAll('*'))).forEach(function (e) {
      Array.prototype.slice.call(e.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) e.removeAttribute(a.name);
      });
    });
    return node;
  }
  if (inp.fix.kind === 'css') {
    var st = document.createElement('style');
    st.setAttribute('data-legible-fix', '');
    st.textContent = inp.fix.code;
    (document.head || document.documentElement).appendChild(st);
    undo.push(function () { st.remove(); });
    el.setAttribute(MARK, '');
  } else if (inp.fix.kind === 'html' && inp.replace) {
    var kids = parse(inp.fix.code);
    if (inp.fix.code.length > ${MAX_FIX_CHARS} || kids.length !== 1 || ['html', 'head', 'body'].indexOf(kids[0].tagName.toLowerCase()) >= 0) return 'untestable';
    if (kids[0].tagName.toLowerCase() === 'script') return 'untestable';
    var neu = clean(document.importNode(kids[0], true));
    el.replaceWith(neu);
    neu.setAttribute(MARK, '');
    undo.push(function () { neu.replaceWith(el); });
  } else if (inp.fix.kind === 'html') {
    var fixed = parse(inp.fix.code), orig = parse(inp.html);
    if (orig.length !== 1) return 'untestable';
    var tag = el.tagName.toLowerCase();
    if (orig[0].tagName.toLowerCase() !== tag) return 'untestable';
    if (fixed.length === 2 && fixed[0].tagName.toLowerCase() === 'label' && fixed[1].tagName.toLowerCase() === tag) {
      // A label added before the field.
      var label = clean(document.importNode(fixed[0], true));
      el.parentNode.insertBefore(label, el);
      undo.push(function () { label.remove(); });
    } else if (fixed.length === 1 && fixed[0].tagName.toLowerCase() === tag) {
      // The same element with changed attributes: apply only the differences,
      // so attributes the scan did not record are left alone.
      var f = fixed[0], o = orig[0];
      var names = {};
      Array.prototype.forEach.call(f.attributes, function (a) { names[a.name] = 1; });
      Array.prototype.forEach.call(o.attributes, function (a) { names[a.name] = 1; });
      Object.keys(names).forEach(function (n) {
        var want = f.getAttribute(n), had = o.getAttribute(n);
        if (want === had || /^on/i.test(n) || /^\s*javascript:/i.test(want || '')) return;
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
})(${JSON.stringify(t)})`;

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

// The check before the fix, for the measured rules: a fix can only be shown
// to work where the failure can be seen first.
async function baseline(page: Page, t: FixTry): Promise<boolean> {
  if (t.ruleId === "legible-focus-visible") return !!(await measureFocusAt(page, t.selector));
  if (t.ruleId === "legible-keyboard-trap") return !!(await trapFrom(page, t.selector));
  const found = await pageFindings(page, t.ruleId);
  return found.some((m) => m.selector === t.selector);
}

async function recheck(page: Page, ruleId: string): Promise<Verdict> {
  if (ruleId === "legible-focus-visible" || ruleId === "legible-keyboard-trap") {
    const sel = (await page.evaluate(MARKED_SELECTOR)) as string | null;
    if (!sel) return "unknown";
    const focusable = await page.evaluate(
      `(function () { var e = document.querySelector('[${MARK}]'); if (!e) return false; e.focus(); return document.activeElement === e; })()`,
    );
    if (!focusable) return "unknown";
    const still = ruleId === "legible-focus-visible" ? await measureFocusAt(page, sel) : await trapFrom(page, sel);
    return still ? "fail" : "pass";
  }
  if (MEASURED.has(ruleId)) {
    return (await touchesMarked(page, await pageFindings(page, ruleId))) ? "fail" : "pass";
  }
  const res = await new AxeBuilder({ page })
    .include(`[${MARK}]`)
    .options({ runOnly: { type: "rule", values: [ruleId] }, resultTypes: ["violations", "incomplete"] })
    .analyze();
  if (res.violations.some((v) => v.id === ruleId)) return "fail";
  if (res.incomplete.some((v) => v.id === ruleId)) return "unknown";
  return res.passes.some((v) => v.id === ruleId) ? "pass" : "unknown";
}

export async function tryFix(page: Page, t: FixTry): Promise<Verdict> {
  if (t.fix.kind === "note" || t.fix.code.length > MAX_FIX_CHARS || !t.selector) return "untestable";
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async (): Promise<Verdict> => {
      if (MEASURED.has(t.ruleId) && !(await baseline(page, t))) return "unknown";
      const applied = (await page.evaluate(APPLY(t))) as string;
      if (applied !== "applied") return "untestable";
      return recheck(page, t.ruleId);
    })();
    const out = new Promise<Verdict>((resolve) => {
      timer = setTimeout(() => resolve("unknown"), TRY_MS);
    });
    return await Promise.race([work, out]).catch(() => "unknown" as const);
  } finally {
    clearTimeout(timer);
    await page.evaluate(UNDO).catch(() => {});
  }
}
