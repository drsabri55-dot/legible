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

export async function keyboardWalk(
  page: Page,
  opts: { maxTabs?: number; maxFocusChecks?: number } = {},
): Promise<{ reached: string[]; findings: Measured[] }> {
  const maxTabs = opts.maxTabs ?? MAX_TABS;
  const maxChecks = opts.maxFocusChecks ?? MAX_FOCUS_CHECKS;
  await page.evaluate("document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)");
  const order: string[] = [];
  const reached: string[] = [];
  const checked = new Set<string>();
  const findings: Measured[] = [];
  let ended = false;
  let lastHtml = "";
  for (let i = 0; i < maxTabs; i++) {
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
  if (!ended && order.length >= TRAP_PRESSES) {
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
  return { reached, findings };
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
