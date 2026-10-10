// Measurements that decide whether the agent's findings are reported. They
// run in the real browser with no AI involved: a failure here is proven.
import type { Page } from "playwright";
import { SELECTOR_FN, changedShare, focusInfoScript, type FocusInfo } from "./dom";

export type MeasuredKind = "keyboard-trap" | "focus-visible" | "reflow" | "keyboard-reach" | "text-spacing";

export interface Measured {
  kind: MeasuredKind;
  verdict: "fail" | "review";
  selector: string;
  html: string;
  detail: string;
  shot?: Buffer;
}

const MAX_TABS = 150;
const MAX_FOCUS_CHECKS = 60;
const TRAP_SET = 6;
const TRAP_PRESSES = 30;
// Focus indicators: under 0.5% of the area changed is no indicator at all;
// up to 3% is too faint to call either way.
const FOCUS_FAIL = 0.005;
const FOCUS_REVIEW = 0.03;

type Rect = { x: number; y: number; width: number; height: number };

async function focused(page: Page): Promise<FocusInfo> {
  return (await page.evaluate(focusInfoScript()).catch(() => null)) as FocusInfo;
}

// The element's box plus 8 pixels, then up to three ancestors that hold no
// other focusable element and cover at most a quarter of the window (a card
// that shows the focus ring for its one link), clipped to the window. Empty
// when the element is not visible.
function rectsScript(selector: string): string {
  return `(function () {
    var el; try { el = document.querySelector(${JSON.stringify(selector)}); } catch (e) { return []; }
    if (!el) return [];
    var vw = window.innerWidth, vh = window.innerHeight, out = [];
    var focusable = 'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';
    for (var depth = 0; el && el !== document.body && depth < 4; depth++, el = el.parentElement) {
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) { if (depth === 0) return []; continue; }
      if (depth > 0 && (el.querySelectorAll(focusable).length > 1 || r.width * r.height > vw * vh / 4)) break;
      var x = Math.max(0, Math.floor(r.left - 8)), y = Math.max(0, Math.floor(r.top - 8));
      var w = Math.min(vw, Math.ceil(r.right + 8)) - x, h = Math.min(vh, Math.ceil(r.bottom + 8)) - y;
      if (w > 0 && h > 0) out.push({ x: x, y: y, width: w, height: h });
    }
    return out;
  })()`;
}

async function shots(page: Page, rects: Rect[]): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const clip of rects) out.push(await page.screenshot({ clip, type: "png", animations: "disabled" }));
  return out;
}

// With the element focused by the keyboard: compare its area focused and
// unfocused, then give focus back so Tab carries on from it.
async function focusVerdict(page: Page, info: NonNullable<FocusInfo>): Promise<Measured | null> {
  const rects = (await page.evaluate(rectsScript(info.selector))) as Rect[];
  if (!rects.length) return null;
  const on = await shots(page, rects);
  const evidence = await page.screenshot({ clip: rects[0], type: "jpeg", quality: 70 });
  await page.evaluate("document.activeElement && document.activeElement.blur()");
  const off = await shots(page, rects);
  await page.evaluate(`(function () { var e = document.querySelector(${JSON.stringify(info.selector)}); if (e) e.focus(); })()`);
  const share = Math.max(...on.map((b, i) => changedShare(b, off[i])));
  if (share >= FOCUS_REVIEW) return null;
  return {
    kind: "focus-visible",
    verdict: share < FOCUS_FAIL ? "fail" : "review",
    selector: info.selector,
    html: info.html,
    detail: `${(share * 100).toFixed(1)}% of the area around the element changed when it received focus.`,
    shot: evidence,
  };
}

const FOCUSABLE_OUTSIDE = (inside: string[]) => `(function () {
  ${SELECTOR_FN}
  var inside = ${JSON.stringify(inside)};
  var all = document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable="true"]');
  var n = 0;
  for (var i = 0; i < all.length; i++) {
    var el = all[i], r = el.getBoundingClientRect();
    if (el.disabled || r.width < 1 || r.height < 1) continue;
    if (inside.indexOf(__sel(el)) === -1) n++;
  }
  return n;
})()`;

// From the focused element: press `key` repeatedly and collect where focus goes.
async function pressAndCollect(page: Page, key: string, times: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    const f = await focused(page);
    seen.push(f?.selector ?? "(page)");
  }
  return seen;
}

// A trap: focus cycles inside a few elements and neither Shift+Tab nor
// Escape then Tab gets out, while there is more on the page to reach.
async function confirmTrap(page: Page, inside: string[], html: string): Promise<Measured | null> {
  const set = new Set(inside);
  const back = await pressAndCollect(page, "Shift+Tab", TRAP_PRESSES);
  if (back.some((s) => !set.has(s))) return null;
  await page.keyboard.press("Escape");
  const after = await pressAndCollect(page, "Tab", 3);
  if (after.some((s) => !set.has(s))) return null;
  const outside = (await page.evaluate(FOCUSABLE_OUTSIDE([...set]))) as number;
  if (outside === 0) return null;
  return {
    kind: "keyboard-trap",
    verdict: "fail",
    selector: [...set][0],
    html,
    detail: `Focus cycles between ${set.size} ${set.size === 1 ? "element" : "elements"} and Tab, Shift+Tab and Escape cannot leave them. ${outside} other controls on the page cannot be reached.`,
  };
}

// `complete` is false when the walk stopped at its deadline, before the end
// of the page: a trap could not be ruled out then.
export async function keyboardWalk(
  page: Page,
  opts: { maxTabs?: number; maxFocusChecks?: number; deadline?: number } = {},
): Promise<{ reached: string[]; findings: Measured[]; complete: boolean }> {
  const maxTabs = opts.maxTabs ?? MAX_TABS;
  const maxChecks = opts.maxFocusChecks ?? MAX_FOCUS_CHECKS;
  await page.evaluate("document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)");
  const order: string[] = [];
  const reached: string[] = [];
  const checked = new Set<string>();
  const findings: Measured[] = [];
  let ended = false;
  let outOfTime = false;
  let lastHtml = "";
  for (let i = 0; i < maxTabs; i++) {
    if (opts.deadline && Date.now() >= opts.deadline) {
      outOfTime = true;
      break;
    }
    await page.keyboard.press("Tab");
    const info = await focused(page);
    if (!info) {
      ended = true; // focus left the page
      break;
    }
    if (order.length && info.selector === order[0] && order.length > 1) {
      ended = true; // wrapped round to the first stop
      break;
    }
    order.push(info.selector);
    lastHtml = info.html;
    if (!reached.includes(info.selector)) reached.push(info.selector);
    if (!checked.has(info.selector) && checked.size < maxChecks) {
      checked.add(info.selector);
      const v = await focusVerdict(page, info);
      if (v) findings.push(v);
    }
  }
  if (!ended && !outOfTime && order.length >= TRAP_PRESSES) {
    const tail = order.slice(-TRAP_PRESSES);
    const set = [...new Set(tail)];
    if (set.length <= TRAP_SET) {
      const trap = await confirmTrap(page, set, lastHtml);
      if (trap) findings.push(trap);
    } else if (set.length < TRAP_PRESSES) {
      // Focus keeps repeating a larger set and never reaches the end.
      findings.push({
        kind: "keyboard-trap",
        verdict: "review",
        selector: set[0],
        html: lastHtml,
        detail: `Tab kept cycling through ${set.length} elements and did not reach the end of the page.`,
      });
    }
  }
  return { reached, findings, complete: !outOfTime };
}

// Focus one element with the keyboard's last step (Tab from the element just
// before it), then measure. Used for elements the agent finds in states it
// opened, such as a menu.
export async function measureFocusAt(page: Page, selector: string): Promise<Measured | null> {
  const ok = await page
    .evaluate(`(function () { var e; try { e = document.querySelector(${JSON.stringify(selector)}); } catch (x) { return false; } if (!e) return false; e.focus(); return document.activeElement === e; })()`)
    .catch(() => false);
  if (!ok) return null;
  // Shift+Tab then Tab lands on it again by keyboard, so :focus-visible applies.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const info = await focused(page);
  if (!info || info.selector !== selector) return null;
  return focusVerdict(page, info);
}

export async function trapFrom(page: Page, selector: string): Promise<Measured | null> {
  const ok = await page
    .evaluate(`(function () { var e; try { e = document.querySelector(${JSON.stringify(selector)}); } catch (x) { return false; } if (!e) return false; e.focus(); return document.activeElement === e; })()`)
    .catch(() => false);
  if (!ok) return null;
  const html = (await focused(page))?.html ?? "";
  const seen = await pressAndCollect(page, "Tab", TRAP_PRESSES);
  const set = [...new Set(seen)];
  if (set.length > TRAP_SET || set.includes("(page)")) return null;
  return confirmTrap(page, set, html);
}

// 320 CSS pixels wide is 400% zoom on a 1280 pixel window (WCAG 1.4.10).
const REFLOW = { width: 320, height: 800 };
// Content WCAG allows to need two-dimensional scrolling.
const REFLOW_ALLOWED = "table, pre, code, video, canvas, svg, img, iframe, map, [role=grid], [role=table]";

const REFLOW_SCRIPT = `(function () {
  ${SELECTOR_FN}
  var vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= vw + 4) return [];
  var out = [], all = document.body.querySelectorAll('*');
  for (var i = 0; i < all.length && out.length < 5; i++) {
    var el = all[i], r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= vw + 4) continue;
    var s = getComputedStyle(el);
    if (s.position === 'fixed' || s.visibility === 'hidden') continue;
    var covered = false;
    for (var j = 0; j < out.length; j++) if (out[j].el.contains(el)) covered = true;
    if (covered) continue;
    var allowed = !!(el.closest(${JSON.stringify(REFLOW_ALLOWED)}) || el.querySelector(${JSON.stringify(REFLOW_ALLOWED)}) && el.innerText.trim() === '');
    out.push({ el: el, selector: __sel(el), html: el.outerHTML.slice(0, 300), allowed: allowed, right: Math.round(r.right) });
  }
  return out.map(function (o) { return { selector: o.selector, html: o.html, allowed: o.allowed, right: o.right, width: vw }; });
})()`;

export async function measureReflow(page: Page): Promise<Measured[]> {
  const before = page.viewportSize() ?? { width: 1280, height: 900 };
  await page.setViewportSize(REFLOW);
  await page.waitForTimeout(300);
  try {
    const hits = (await page.evaluate(REFLOW_SCRIPT)) as {
      selector: string;
      html: string;
      allowed: boolean;
      right: number;
      width: number;
    }[];
    return hits.map((h) => ({
      kind: "reflow" as const,
      verdict: h.allowed ? ("review" as const) : ("fail" as const),
      selector: h.selector,
      html: h.html,
      detail: `At 400% zoom the window is ${h.width} pixels wide and this element reaches ${h.right} pixels, so people must scroll sideways.`,
    }));
  } finally {
    await page.setViewportSize(before);
  }
}

// WCAG 1.4.12's test values.
export const TEXT_SPACING_CSS =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";

const SPACING_ON = `(function () {
  var s = document.createElement('style');
  s.id = 'legible-text-spacing';
  s.textContent = ${JSON.stringify(TEXT_SPACING_CSS)};
  document.head.appendChild(s);
})()`;
const SPACING_OFF = "(function () { var s = document.getElementById('legible-text-spacing'); if (s) s.remove(); })()";

const CLIPPED_SCRIPT = `(function () {
  ${SELECTOR_FN}
  var out = [], all = document.body.querySelectorAll('*');
  for (var i = 0; i < all.length && out.length < 20; i++) {
    var el = all[i], s = getComputedStyle(el);
    if (s.overflow === 'visible' && s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    var hasText = false;
    for (var k = 0; k < el.childNodes.length; k++) if (el.childNodes[k].nodeType === 3 && el.childNodes[k].textContent.trim()) hasText = true;
    if (!hasText) continue;
    if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
      out.push({ selector: __sel(el), html: el.outerHTML.slice(0, 300) });
    }
  }
  return out;
})()`;

export async function measureTextSpacing(page: Page): Promise<Measured[]> {
  // Boxes that already clip without the extra spacing are not this problem.
  const before = new Set(((await page.evaluate(CLIPPED_SCRIPT)) as { selector: string }[]).map((c) => c.selector));
  await page.evaluate(SPACING_ON);
  try {
    const after = (await page.evaluate(CLIPPED_SCRIPT)) as { selector: string; html: string }[];
    return after
      .filter((c) => !before.has(c.selector))
      .map((c) => ({
        kind: "text-spacing" as const,
        verdict: "review" as const,
        selector: c.selector,
        html: c.html,
        detail: "With wider line, letter and word spacing, this text no longer fits its box and is cut off.",
      }));
  } finally {
    await page.evaluate(SPACING_OFF);
  }
}

// Elements with their own click handler and a pointer cursor that cannot take
// focus. getEventListeners exists only in the DevTools console, so this runs
// through the Chrome DevTools Protocol.
const REACH_SCRIPT = `(function () {
  ${SELECTOR_FN}
  var native = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';
  var out = [], all = document.body.querySelectorAll('*');
  for (var i = 0; i < all.length && out.length < 20; i++) {
    var el = all[i];
    if (el.matches(native) || el.closest(native)) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    var l = getEventListeners(el);
    if (!(l.click && l.click.length) && !(l.mousedown && l.mousedown.length) && !(l.pointerdown && l.pointerdown.length)) continue;
    out.push({ selector: __sel(el), html: el.outerHTML.slice(0, 300) });
  }
  return out;
})()`;

export async function measureKeyboardReach(page: Page, reached: string[]): Promise<Measured[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const res = (await cdp.send("Runtime.evaluate", {
      expression: REACH_SCRIPT,
      includeCommandLineAPI: true,
      returnByValue: true,
    })) as { result?: { value?: { selector: string; html: string }[] } };
    const hits = res.result?.value ?? [];
    return hits
      .filter((h) => !reached.includes(h.selector))
      .map((h) => ({
        kind: "keyboard-reach" as const,
        verdict: "review" as const,
        selector: h.selector,
        html: h.html,
        detail: "This element reacts to a click and shows a pointer, but the Tab key never reaches it.",
      }));
  } finally {
    await cdp.detach().catch(() => {});
  }
}
