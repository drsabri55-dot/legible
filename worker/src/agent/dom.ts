// In-page helpers shared by the agent's measurements and actions. Every
// script is a string: tsx adds helper calls to compiled functions that do not
// exist inside the page.
import { PNG } from "pngjs";

export type FocusInfo = { selector: string; tag: string; role: string; name: string; html: string } | null;

// Defines __sel(el): a selector that finds exactly this element, using a
// unique id where there is one, else tag:nth-of-type steps from <body>.
export const SELECTOR_FN = `
var __uid = function (id) {
  try { return document.querySelectorAll('#' + CSS.escape(id)).length === 1; } catch (e) { return false; }
};
var __sel = function (el) {
  if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) return null;
  if (el.id && __uid(el.id)) return '#' + CSS.escape(el.id);
  var parts = [];
  while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
    if (el.id && __uid(el.id)) { parts.unshift('#' + CSS.escape(el.id)); return parts.join(' > '); }
    var i = 1, s = el;
    while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
    parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    el = el.parentElement;
  }
  return 'body > ' + parts.join(' > ');
};
var __name = function (el) {
  var n = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.value || '';
  return String(n).replace(/\\s+/g, ' ').trim().slice(0, 80);
};
`;

export function focusInfoScript(): string {
  return `(function () {
    ${SELECTOR_FN}
    var el = document.activeElement;
    var sel = __sel(el);
    if (!sel) return null;
    return {
      selector: sel,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      name: __name(el),
      html: el.outerHTML.slice(0, 300)
    };
  })()`;
}

export function elementInfoScript(selector: string): string {
  return `(function () {
    var el;
    try { el = document.querySelector(${JSON.stringify(selector)}); } catch (e) { return null; }
    if (!el) return null;
    var around = el.parentElement ? el.parentElement.innerText : '';
    return {
      html: el.outerHTML.slice(0, 800),
      text: String(el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
      around: String(around || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
      alt: el.getAttribute('alt'),
      tag: el.tagName.toLowerCase()
    };
  })()`;
}

// The share of pixels that clearly changed between two same-size PNGs. A
// channel must move by more than 32 of 255 to count, so anti-aliasing and
// rendering noise are ignored.
export function changedShare(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return 1;
  const n = pa.width * pa.height;
  if (!n) return 0;
  let changed = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    if (
      Math.abs(pa.data[i] - pb.data[i]) > 32 ||
      Math.abs(pa.data[i + 1] - pb.data[i + 1]) > 32 ||
      Math.abs(pa.data[i + 2] - pb.data[i + 2]) > 32
    ) {
      changed++;
    }
  }
  return changed / n;
}
