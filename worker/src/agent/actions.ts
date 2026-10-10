// The only things the agent can do to a page: keyboard, zoom, text spacing
// and looking. Every input is checked here again, whatever the model sends.
import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { SELECTOR_FN, focusInfoScript, type FocusInfo } from "./dom";
import { TEXT_SPACING_CSS } from "./measure";

export const KEYS = ["Tab", "Shift+Tab", "Enter", "Space", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
// The agent cannot choose what to type, so it can never enter anything real.
export const TEST_TEXT = ["Test name", "test@example.com", "07700 900000", "Test message", "SW1A 1AA", "Test"] as const;
export const CLAIM_KINDS = ["keyboard-trap", "focus-visible"] as const;
export const REVIEW_KINDS = ["image-description", "link-purpose", "heading-fit", "error-help", "captions"] as const;

const obj = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const AGENT_TOOLS: Anthropic.Tool[] = [
  { name: "press", description: "Press one key on the page.", input_schema: obj({ key: { type: "string", enum: [...KEYS] } }) },
  { name: "type", description: "Type test text into the field that has focus.", input_schema: obj({ text: { type: "string", enum: [...TEST_TEXT] } }) },
  { name: "zoom", description: "Turn 400% zoom on (a 320 pixel wide window) or off.", input_schema: obj({ on: { type: "boolean" } }) },
  { name: "spacing", description: "Turn WCAG text spacing on or off.", input_schema: obj({ on: { type: "boolean" } }) },
  { name: "look", description: "Take a fresh screenshot of the window.", input_schema: obj({}) },
  {
    name: "claim",
    description: "Report a possible keyboard trap or invisible focus, in a state you opened. Legible measures it before reporting.",
    input_schema: obj({ kind: { type: "string", enum: [...CLAIM_KINDS] }, selector: { type: "string" }, note: { type: "string" } }),
  },
  {
    name: "judge",
    description: "Report something that needs judgement. A second check decides whether it is kept.",
    input_schema: obj({ kind: { type: "string", enum: [...REVIEW_KINDS] }, selector: { type: "string" }, reason: { type: "string" } }),
  },
  { name: "done", description: "Finish testing this page.", input_schema: obj({ summary: { type: "string" } }) },
];

export interface ActionState {
  url: string;
  zoomed: boolean;
  spaced: boolean;
}

const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 320, height: 800 };

export function samePage(a: string, b: string): boolean {
  const x = new URL(a);
  const y = new URL(b);
  return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
}

function describeFocus(f: FocusInfo): string {
  if (!f) return "Focus: nothing on the page.";
  return `Focus: ${f.tag}${f.role ? ` role=${f.role}` : ""} "${f.name}" (${f.selector})`;
}

async function screenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: "jpeg", quality: 60 });
}

export async function perform(
  page: Page,
  name: string,
  input: unknown,
  state: ActionState,
): Promise<{ ok: boolean; text: string; image?: Buffer }> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  let note = "";
  switch (name) {
    case "press": {
      const key = args.key;
      if (!KEYS.includes(key as (typeof KEYS)[number])) return { ok: false, text: `Not a key you can press: ${String(key)}.` };
      // Enter and Space can follow a link. Real servers take a while to
      // answer, so watch for a page load starting, then wait for it to land.
      const mayNavigate = key === "Enter" || key === "Space";
      const started = mayNavigate
        ? page.waitForRequest((r) => r.isNavigationRequest() && r.frame() === page.mainFrame(), { timeout: 700 }).catch(() => null)
        : null;
      await page.keyboard.press(key as string);
      const request = started ? await started : null;
      if (request) {
        await Promise.race([
          page.waitForEvent("framenavigated", { predicate: (f) => f === page.mainFrame(), timeout: 15_000 }).catch(() => null),
          page.waitForEvent("requestfailed", { predicate: (r) => r === request, timeout: 15_000 }).catch(() => null),
        ]);
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
      } else {
        await page.waitForTimeout(200);
      }
      break;
    }
    case "type": {
      const text = args.text;
      if (!TEST_TEXT.includes(text as (typeof TEST_TEXT)[number])) return { ok: false, text: "Only the listed test text can be typed." };
      const editable = await page.evaluate(
        "(function () { var e = document.activeElement; return !!e && (e.isContentEditable || /^(input|textarea)$/i.test(e.tagName)); })()",
      );
      if (!editable) return { ok: false, text: "Nothing that accepts text has focus." };
      await page.keyboard.type(text as string, { delay: 10 });
      break;
    }
    case "zoom": {
      if (typeof args.on !== "boolean") return { ok: false, text: "zoom needs on: true or false." };
      await page.setViewportSize(args.on ? NARROW : WIDE);
      state.zoomed = args.on;
      await page.waitForTimeout(300);
      break;
    }
    case "spacing": {
      if (typeof args.on !== "boolean") return { ok: false, text: "spacing needs on: true or false." };
      await page.evaluate(
        args.on
          ? `(function () { if (document.getElementById('legible-text-spacing')) return; var s = document.createElement('style'); s.id = 'legible-text-spacing'; s.textContent = ${JSON.stringify(TEXT_SPACING_CSS)}; document.head.appendChild(s); })()`
          : "(function () { var s = document.getElementById('legible-text-spacing'); if (s) s.remove(); })()",
      );
      state.spaced = args.on;
      break;
    }
    case "look":
      break;
    default:
      return { ok: false, text: `Unknown action: ${name}.` };
  }
  if (!samePage(page.url(), state.url)) {
    await page.goto(state.url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    if (state.zoomed) await page.setViewportSize(NARROW);
    note = " That opened another page, so Legible returned to the page under test.";
  }
  const f = (await page.evaluate(focusInfoScript()).catch(() => null)) as FocusInfo;
  const view = `${state.zoomed ? " Window: 320 pixels wide (400% zoom)." : ""}${state.spaced ? " Text spacing: on." : ""}`;
  return { ok: true, text: `${describeFocus(f)}${view}${note}`, image: await screenshot(page) };
}

export function pageOutlineScript(): string {
  return `(function () {
    ${SELECTOR_FN}
    var lines = [], clean = function (t) { return String(t || '').replace(/\\s+/g, ' ').trim().slice(0, 80); };
    var take = function (selector, limit, line) {
      var all = document.querySelectorAll(selector);
      for (var i = 0; i < all.length && i < limit; i++) { var s = line(all[i]); if (s) lines.push(__sel(all[i]) + ' | ' + s); }
    };
    take('h1, h2, h3, h4, h5, h6', 30, function (e) { return e.tagName.toLowerCase() + ' | "' + clean(e.innerText) + '"'; });
    take('img', 40, function (e) { return 'img | alt=' + (e.hasAttribute('alt') ? '"' + clean(e.getAttribute('alt')) + '"' : '(none)') + ' | src=' + clean((e.getAttribute('src') || '').split('/').pop()); });
    take('a[href]', 80, function (e) { return 'link | "' + clean(__name(e)) + '"'; });
    take('button, [role=button]', 40, function (e) { return 'button | "' + clean(__name(e)) + '"'; });
    take('input:not([type=hidden]), select, textarea', 30, function (e) { var l = e.labels && e.labels[0] ? e.labels[0].innerText : e.getAttribute('aria-label'); return 'field | label="' + clean(l) + '"'; });
    take('video, iframe[src*="youtube"], iframe[src*="vimeo"]', 10, function (e) { return 'video | tracks=' + (e.querySelectorAll ? e.querySelectorAll('track').length : 0); });
    return lines.join('\\n');
  })()`;
}
