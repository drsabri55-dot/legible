# Testing agent, phase 1 (agent core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The scan worker gets a testing agent. On every page it measures keyboard traps, invisible focus, reflow at 400% zoom, text spacing and unreachable clickable elements. An AI model (Claude) then uses the page with the keyboard and flags judgement problems. Every result reaches the score, the "Check by hand" list, a new "The agent's review" report section and element screenshots.

**Architecture:** A new folder `worker/src/agent/` holds the measurements (`measure.ts`), the safety guard (`guard.ts`), the model interface (`model.ts`), the keyboard actions (`actions.ts`), the prompts (`prompts.ts`), the second opinion (`review.ts`) and the per-page loop (`run.ts`). `scanSite` calls the agent after axe-core when it is given an `AgentModel`. Results travel in the existing `RawScan` contract (new optional fields). Screenshots travel separately (`shots` callback) into a new `scan_shots` table. The site never switches the agent on in phase 1. Only the worker CLI (`--agent`) and tests use it. The daily cap comes in phase 2, before any visitor gets the agent.

**Tech Stack:** Node 20+, TypeScript, Playwright 1.63 (Chromium), axe-core 4.13, `@anthropic-ai/sdk` (model `claude-sonnet-5-5`), `pngjs` (pixel comparison), Vitest, Next.js 16 (site), postgres.js.

**Spec:** `docs/superpowers/specs/2026-10-09-testing-agent-design.md` (sections 3, 7 and 8 are this phase).

## Global Constraints

- Worker `page.evaluate` must receive a **string**, never a function. tsx injects a `__name` helper the page does not have. Every in-page script in this plan is a string.
- `worker/src/types.ts` and `src/types/scan.ts` must stay identical from `export interface RawNode` to the end of the file (`diff` of the two is empty).
- Model: `process.env.AGENT_MODEL || "claude-sonnet-5-5"`. Never append a date suffix. Use `tool_choice: { type: "auto" }` with `strict: true` tools, because forced tool choice returns 400 on this model. Use `output_config: { effort: "medium" }` and top-level `cache_control: { type: "ephemeral" }`. Append `response.content` unchanged, so the history stays append-only.
- No `ANTHROPIC_API_KEY`: the agent never runs, and everything behaves exactly as today.
- In phase 1, the site never sends `agent: true`. Only the worker CLI and tests run the agent.
- Agent limits per page: `MAX_STEPS = 20` tool calls, `LOOP_MS = 90_000` for the model loop, `AGENT_BUDGET_MS = 180_000` for measuring, the loop and second opinions together.
- During the agent, every non-GET/HEAD request is aborted, as is navigation to another site. Dialogs are dismissed and pop-ups closed.
- Rule ids: `legible-keyboard-trap`, `legible-focus-visible`, `legible-reflow` (can fail), `legible-keyboard-reach`, `legible-text-spacing` (only ever "Check by hand"). Judgement kinds: `image-description`, `link-purpose`, `heading-fit`, `error-help`, `captions`.
- Thresholds: focus change under 0.5% of pixels is a fail, 0.5% to 3% is "Check by hand". Reflow overflow over 4 CSS pixels. A trap is a cycle of 6 or fewer elements that Tab, Shift+Tab and Escape cannot leave, while other focusable elements exist.
- New tables enable RLS, with no policies, plus the Supabase revoke block.
- Copy rules: British spelling, short sentences, no em-dash chains, no "not X, but Y". Never "compliant" or "legally safe". New customer-facing wording goes into the owner's design doc for approval (Task 16).
- Commit after every task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not stage `.gitignore`, `eslint.config.mjs`, `tsconfig.json` or `.design-sync/`, which belong to another session.

## Review Focus

1. **A page with an animation away from the element** (carousel, spinner) must not hide a missing focus indicator or invent one. The focus measurement compares only the element's area and its close ancestors. Test: `focus.html` has a spinning banner, and `#bad` still fails (Task 4).
2. **A long page with more than 150 focusable elements** is not a trap and needs no hand check. Test: `long.html` with 200 links gives no `keyboard-trap` finding (Task 4).
3. **Enter on a same-site link** opens another page. The agent must return to the page under test and say so. Test in Task 8.
4. **The model sends an unknown tool or a bad input value.** It is refused with `is_error`, counted as a step, and nothing crashes. Test in Task 10.
5. **The model names an element that does not exist** in a claim or judge. It is dropped and nothing crashes. Test in Task 10.

---

### Task 1: The scan contract gains agent fields

**Files:**
- Modify: `worker/src/types.ts`
- Modify: `src/types/scan.ts`
- Modify: `docs/superpowers/specs/2026-10-09-testing-agent-design.md` (one line in 3.6)
- Test: `tests/unit/contract.test.ts` (new)

**Interfaces:**
- Produces: `RawNode.shot?: string`, `RawPage.agent?: AgentPageResult`, `RawScan.agent?: { model: string; usage: AgentUsage }`, and the types `AgentUsage`, `AgentReview`, `AgentReviewKind`, `AgentPageResult`.

- [ ] **Step 1: Write the failing test**

`tests/unit/contract.test.ts`:

```ts
// The worker and the site share one scan contract, kept in two files.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const part = (file: string) => {
  const text = readFileSync(file, "utf8");
  return text.slice(text.indexOf("export interface RawNode"));
};

describe("scan contract", () => {
  it("is identical in the worker and the site", () => {
    expect(part("src/types/scan.ts")).toBe(part("worker/src/types.ts"));
  });

  it("carries the agent's results", () => {
    const text = part("src/types/scan.ts");
    for (const name of ["AgentUsage", "AgentReview", "AgentReviewKind", "AgentPageResult", "shot?: string", "agent?: AgentPageResult"]) {
      expect(text).toContain(name);
    }
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run tests/unit/contract.test.ts`
Expected: the first test PASSES and the second FAILS (`AgentUsage` missing).

- [ ] **Step 3: Add the fields to both files**

In **both** `worker/src/types.ts` and `src/types/scan.ts`, add this field at the end of `RawNode`:

```ts
  // A screenshot of the element, taken by the testing agent. The site stores
  // the image in scan_shots under this id.
  shot?: string;
```

Add this field at the end of `RawPage`:

```ts
  // What the testing agent did on this page. Missing when it did not run.
  agent?: AgentPageResult;
```

Add this field at the end of `RawScan`, after `pages`:

```ts
  // Set when the testing agent ran: the model and the tokens it used.
  agent?: { model: string; usage: AgentUsage };
```

Then append this to the end of both files, after `ScanStatus`:

```ts
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type AgentReviewKind = "image-description" | "link-purpose" | "heading-fit" | "error-help" | "captions";

// A judgement finding both AI passes agreed on. Never counted in the score.
export interface AgentReview {
  kind: AgentReviewKind;
  selector: string;
  html: string;
  reason: string;
  shot?: string;
}

export interface AgentPageResult {
  status: "tested" | "partly" | "failed" | "off";
  // "step limit", "time limit", "model error", "declined"
  reason?: string;
  steps: number;
  reviews: AgentReview[];
  usage: AgentUsage;
}
```

- [ ] **Step 4: Align the spec**

In `docs/superpowers/specs/2026-10-09-testing-agent-design.md` section 3.6, replace
`` The `RawScan` gains `agent?: { model: string; usage: {...}; costUsd: number }`. ``
with
`` The `RawScan` gains `agent?: { model: string; usage: AgentUsage }`. The site works out the cost from the tokens and its price settings (phase 2), so the worker never needs prices. ``

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/unit/contract.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add worker/src/types.ts src/types/scan.ts tests/unit/contract.test.ts docs/superpowers/specs/2026-10-09-testing-agent-design.md
git commit -m "Scan contract: the testing agent's results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Fixture pages with one known problem each

**Files:**
- Create: `tests/fixtures/site/agent/clean.html`, `trap.html`, `focus.html`, `long.html`, `reflow.html`, `table.html`, `spacing.html`, `reach.html`, `post.html`, `nav.html`, `alt.html`
- Modify: `tests/fixtures/serve.mjs` (count non-GET requests and serve the count at `/__posts`)
- Test: `worker/test/fixtures.test.ts` (new)

None of these pages is linked from `index.html`, so the existing `scanSite` test keeps its exact page list.

- [ ] **Step 1: Write the failing test**

`worker/test/fixtures.test.ts`:

```ts
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";

const PORT = 5067;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(() => server.close());

it("serves the agent fixture pages and counts form posts", async () => {
  for (const name of ["clean", "trap", "focus", "long", "reflow", "table", "spacing", "reach", "post", "nav", "alt"]) {
    const res = await fetch(`http://127.0.0.1:${PORT}/agent/${name}.html`);
    expect(res.status, name).toBe(200);
  }
  expect(await (await fetch(`http://127.0.0.1:${PORT}/__posts`)).text()).toBe("0");
  await fetch(`http://127.0.0.1:${PORT}/agent/submit`, { method: "POST", body: "n=1" });
  expect(await (await fetch(`http://127.0.0.1:${PORT}/__posts`)).text()).toBe("1");
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- fixtures`
Expected: FAIL (404 for `/agent/clean.html`).

- [ ] **Step 3: Count posts in the fixture server**

In `tests/fixtures/serve.mjs`, inside `serveFixture`, before `const server = createServer(`, add `let posts = 0;`. Then add these as the first lines of the request handler, after `const url = …`:

```js
    // The testing agent must never submit anything: tests read this count.
    if (url.pathname === "/__posts") return res.writeHead(200, { "content-type": "text/plain" }).end(String(posts));
    if (req.method !== "GET" && req.method !== "HEAD") {
      posts++;
      return res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Sent</title><p>Sent</p>");
    }
```

- [ ] **Step 4: Write the fixture pages**

`tests/fixtures/site/agent/clean.html`. This page passes every agent check:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Clean page</title>
    <style>
      body { font: 16px/1.5 sans-serif; margin: 0 auto; max-width: 40rem; padding: 1rem; }
      a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid #1a4fd6; outline-offset: 2px; }
    </style>
  </head>
  <body>
    <nav><a href="#one">One</a> <a href="#two">Two</a></nav>
    <main>
      <h1>Clean page</h1>
      <p id="one">A page that reflows, keeps its focus visible and has no traps.</p>
      <label for="name">Your name</label>
      <input id="name" name="name" />
      <button type="button">Save</button>
      <p id="two"><a href="#one">Back to the first section</a></p>
    </main>
  </body>
</html>
```

`tests/fixtures/site/agent/trap.html`. Tab, Shift+Tab and Escape all stay inside `#widget`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Trap</title></head>
  <body>
    <a href="#before">Before</a>
    <div id="widget">
      <button id="t1" type="button">One</button>
      <button id="t2" type="button">Two</button>
      <button id="t3" type="button">Three</button>
    </div>
    <a href="#after">After</a>
    <script>
      var b = Array.prototype.slice.call(document.querySelectorAll("#widget button"));
      document.getElementById("widget").addEventListener("keydown", function (e) {
        if (e.key !== "Tab") return;
        e.preventDefault();
        var i = b.indexOf(document.activeElement);
        b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
      });
    </script>
  </body>
</html>
```

`tests/fixtures/site/agent/focus.html`. In it, `#bad` has no focus style, `#good` has an outline, `#card-link` shows focus on its card, and a spinning banner sits away from all three:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Focus</title>
    <style>
      body { font: 16px/1.5 sans-serif; padding: 2rem; }
      a { color: #1a1a1a; }
      a:focus { outline: none; }
      #good:focus { outline: 3px solid #000; outline-offset: 2px; }
      .card { display: block; padding: 1rem; width: 16rem; margin: 2rem 0; border: 1px solid #ccc; }
      .card:focus-within { outline: 3px solid #000; }
      .spin { position: fixed; right: 1rem; bottom: 1rem; width: 40px; height: 40px; background: #333; animation: s 1s linear infinite; }
      @keyframes s { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <p><a id="bad" href="#x">No visible focus</a></p>
    <p><a id="good" href="#y">Visible focus</a></p>
    <div class="card"><a id="card-link" href="#z">Focus shown on the card</a></div>
    <div class="spin" aria-hidden="true"></div>
  </body>
</html>
```

`tests/fixtures/site/agent/long.html`. It has 200 links and focus is visible:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Long</title></head>
  <body>
    <ul id="list"></ul>
    <script>
      var ul = document.getElementById("list");
      for (var i = 1; i <= 200; i++) {
        var li = document.createElement("li");
        li.innerHTML = '<a href="#l' + i + '">Link ' + i + "</a>";
        ul.appendChild(li);
      }
    </script>
  </body>
</html>
```

`tests/fixtures/site/agent/reflow.html`. A fixed-width text box forces sideways scrolling at 320px:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Reflow</title></head>
  <body>
    <div id="wide" style="width: 900px">This text box is 900 pixels wide, so at 400% zoom people have to scroll sideways to read each line.</div>
  </body>
</html>
```

`tests/fixtures/site/agent/table.html`. The only wide thing is a data table, which WCAG allows:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Table</title></head>
  <body>
    <p>Opening times.</p>
    <table style="min-width: 900px">
      <tr><th>Day</th><th>Morning</th><th>Afternoon</th><th>Evening</th></tr>
      <tr><td>Monday</td><td>9 to 12</td><td>1 to 5</td><td>Closed</td></tr>
    </table>
  </body>
</html>
```

`tests/fixtures/site/agent/spacing.html`. A fixed-height box clips its text when spacing grows:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Spacing</title></head>
  <body>
    <div id="tight" style="height: 20px; width: 220px; overflow: hidden; font: 16px/1.2 sans-serif">Short text that fits</div>
  </body>
</html>
```

`tests/fixtures/site/agent/reach.html`. A clickable `div` that Tab never reaches:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Reach</title></head>
  <body>
    <a href="#a">A real link</a>
    <div id="fake" style="cursor: pointer; padding: 8px; border: 1px solid #333; width: 8rem">Open menu</div>
    <script>
      document.getElementById("fake").addEventListener("click", function () { this.textContent = "Opened"; });
    </script>
  </body>
</html>
```

`tests/fixtures/site/agent/post.html`. A form that posts, and a link to another site (`localhost` is another site from `127.0.0.1`):

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Post</title></head>
  <body>
    <form method="post" action="/agent/submit">
      <label for="n">Name</label>
      <input id="n" name="n" value="x" />
      <button id="send">Send</button>
    </form>
    <a id="away" href="http://localhost:__PORT__/agent/clean.html">Elsewhere</a>
  </body>
</html>
```

`tests/fixtures/site/agent/nav.html`. A same-site link:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Nav</title></head>
  <body>
    <a id="go" href="/agent/clean.html">Go to the clean page</a>
  </body>
</html>
```

`tests/fixtures/site/agent/alt.html`. An image whose alt text does not describe it (`team.png` already exists in the fixture site):

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Alt</title></head>
  <body>
    <h1>Our team</h1>
    <img id="photo" src="/team.png" alt="image123" width="200" height="120" />
    <p><a id="more" href="#more">Click here</a></p>
  </body>
</html>
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix worker test`
Expected: PASS, including the existing `scanSite` test, whose page list must not change.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures worker/test/fixtures.test.ts
git commit -m "Fixture pages for the testing agent, one known problem each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared in-page helpers and pixel comparison

**Files:**
- Modify: `worker/package.json` (dependencies)
- Create: `worker/src/agent/dom.ts`
- Test: `worker/test/agent-dom.test.ts`

**Interfaces:**
- Produces: `SELECTOR_FN: string` (in-page JS that defines `__sel(el)`), `focusInfoScript(): string`, `elementInfoScript(selector: string): string`, `changedShare(a: Buffer, b: Buffer): number`, `type FocusInfo = { selector: string; tag: string; role: string; name: string; html: string } | null`.

- [ ] **Step 1: Install the dependencies**

Run: `npm --prefix worker install @anthropic-ai/sdk pngjs && npm --prefix worker install -D @types/pngjs`
Expected: `worker/package.json` lists `@anthropic-ai/sdk` and `pngjs` under dependencies.

- [ ] **Step 2: Write the failing test**

`worker/test/agent-dom.test.ts`:

```ts
import type { Server } from "node:http";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { changedShare, elementInfoScript, focusInfoScript, type FocusInfo } from "../src/agent/dom";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5068;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

function png(w: number, h: number, paint: (x: number, y: number) => number): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = paint(x, y);
      p.data[i] = p.data[i + 1] = p.data[i + 2] = v;
      p.data[i + 3] = 255;
    }
  return PNG.sync.write(p);
}

describe("changedShare", () => {
  it("is 0 for the same picture and counts clearly changed pixels", () => {
    const a = png(10, 10, () => 255);
    expect(changedShare(a, a)).toBe(0);
    const b = png(10, 10, (x) => (x === 0 ? 0 : 255));
    expect(changedShare(a, b)).toBeCloseTo(0.1);
    // Tiny shifts (anti-aliasing, JPEG noise) are not changes.
    expect(changedShare(a, png(10, 10, () => 240))).toBe(0);
  });
  it("treats different sizes as fully changed", () => {
    expect(changedShare(png(2, 2, () => 0), png(3, 3, () => 0))).toBe(1);
  });
});

describe("in-page helpers", () => {
  it("describes the focused element with a unique selector", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/agent/clean.html`);
    await page.keyboard.press("Tab");
    const info = (await page.evaluate(focusInfoScript())) as FocusInfo;
    expect(info).toMatchObject({ tag: "a", name: "One" });
    expect(await page.locator(info!.selector).count()).toBe(1);
    const el = (await page.evaluate(elementInfoScript("#name"))) as { html: string; text: string } | null;
    expect(el?.html).toContain('id="name"');
    expect(await page.evaluate(elementInfoScript("#nothing-here"))).toBeNull();
    await page.close();
  });
});
```

- [ ] **Step 3: Run the test to check it fails**

Run: `npm --prefix worker test -- agent-dom`
Expected: FAIL (cannot find `../src/agent/dom`).

- [ ] **Step 4: Write `worker/src/agent/dom.ts`**

```ts
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
```

- [ ] **Step 5: Run the test**

Run: `npm --prefix worker test -- agent-dom && npm --prefix worker run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/src/agent/dom.ts worker/test/agent-dom.test.ts
git commit -m "Agent: in-page selectors and pixel comparison

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Keyboard walk, traps and visible focus

**Files:**
- Create: `worker/src/agent/measure.ts`
- Test: `worker/test/measure-keyboard.test.ts`

**Interfaces:**
- Consumes: `SELECTOR_FN`, `focusInfoScript`, `changedShare`, `FocusInfo` from `./dom`.
- Produces:
  - `type MeasuredKind = "keyboard-trap" | "focus-visible" | "reflow" | "keyboard-reach" | "text-spacing"`
  - `interface Measured { kind: MeasuredKind; verdict: "fail" | "review"; selector: string; html: string; detail: string; shot?: Buffer }`
  - `keyboardWalk(page: Page, opts?: { maxTabs?: number; maxFocusChecks?: number }): Promise<{ reached: string[]; findings: Measured[] }>`
  - `measureFocusAt(page: Page, selector: string): Promise<Measured | null>`
  - `trapFrom(page: Page, selector: string): Promise<Measured | null>`

- [ ] **Step 1: Write the failing test**

`worker/test/measure-keyboard.test.ts`:

```ts
import type { Server } from "node:http";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { keyboardWalk, measureFocusAt, trapFrom } from "../src/agent/measure";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5069;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

async function open(name: string): Promise<Page> {
  const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/agent/${name}.html`);
  return page;
}

describe("keyboardWalk", () => {
  it("finds nothing on a clean page and reaches every control", async () => {
    const page = await open("clean");
    const { reached, findings } = await keyboardWalk(page);
    expect(findings).toEqual([]);
    expect(reached.length).toBe(5); // One, Two, the field, Save, the back link
    await page.close();
  });

  it("proves a keyboard trap", async () => {
    const page = await open("trap");
    const { findings } = await keyboardWalk(page);
    const trap = findings.find((f) => f.kind === "keyboard-trap");
    expect(trap).toMatchObject({ verdict: "fail" });
    expect(trap!.selector).toMatch(/#t[123]/);
    await page.close();
  });

  it("does not call a long page a trap", async () => {
    const page = await open("long");
    const { findings } = await keyboardWalk(page);
    expect(findings.filter((f) => f.kind === "keyboard-trap")).toEqual([]);
    await page.close();
  });

  it("fails focus that cannot be seen, and accepts focus shown on the element or its card", async () => {
    const page = await open("focus");
    const { findings } = await keyboardWalk(page);
    const focus = findings.filter((f) => f.kind === "focus-visible");
    expect(focus.map((f) => [f.selector, f.verdict])).toEqual([["#bad", "fail"]]);
    expect(focus[0].shot?.length).toBeGreaterThan(100);
    await page.close();
  });
});

describe("targeted measurements", () => {
  it("measures one element's focus and one trap on request", async () => {
    let page = await open("focus");
    expect(await measureFocusAt(page, "#bad")).toMatchObject({ kind: "focus-visible", verdict: "fail" });
    expect(await measureFocusAt(page, "#good")).toBeNull();
    expect(await measureFocusAt(page, "#missing")).toBeNull();
    await page.close();
    page = await open("trap");
    expect(await trapFrom(page, "#t2")).toMatchObject({ kind: "keyboard-trap", verdict: "fail" });
    await page.close();
    page = await open("clean");
    expect(await trapFrom(page, "#name")).toBeNull();
    await page.close();
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- measure-keyboard`
Expected: FAIL (cannot find `../src/agent/measure`).

- [ ] **Step 3: Write `worker/src/agent/measure.ts`**

```ts
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

// The element's box plus 8 pixels, then up to three ancestors no more than
// four times its area (a card that shows the focus ring), clipped to the
// window. Empty when the element is not visible.
function rectsScript(selector: string): string {
  return `(function () {
    var el; try { el = document.querySelector(${JSON.stringify(selector)}); } catch (e) { return []; }
    if (!el) return [];
    var vw = window.innerWidth, vh = window.innerHeight, out = [], base = 0;
    for (var depth = 0; el && el !== document.body && depth < 4; depth++, el = el.parentElement) {
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) { if (depth === 0) return []; continue; }
      var area = r.width * r.height;
      if (depth === 0) base = area; else if (area > base * 4) break;
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
```

- [ ] **Step 4: Run the test**

Run: `npm --prefix worker test -- measure-keyboard`
Expected: PASS. If `clean` reports a different `reached.length`, print `reached`. The page has exactly 5 focusable controls; fix the walk, not the expectation.

- [ ] **Step 5: Commit**

```bash
git add worker/src/agent/measure.ts worker/test/measure-keyboard.test.ts
git commit -m "Agent: measure keyboard traps and visible focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reflow, text spacing and keyboard reach

**Files:**
- Modify: `worker/src/agent/measure.ts` (append)
- Test: `worker/test/measure-layout.test.ts`

**Interfaces:**
- Produces: `measureReflow(page: Page): Promise<Measured[]>`, `measureTextSpacing(page: Page): Promise<Measured[]>`, `measureKeyboardReach(page: Page, reached: string[]): Promise<Measured[]>`, `TEXT_SPACING_CSS: string`.

- [ ] **Step 1: Write the failing test**

`worker/test/measure-layout.test.ts`:

```ts
import type { Server } from "node:http";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { measureKeyboardReach, measureReflow, measureTextSpacing } from "../src/agent/measure";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5070;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

async function open(name: string): Promise<Page> {
  const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/agent/${name}.html`);
  return page;
}

describe("layout measurements", () => {
  it("fails sideways scrolling at 400% and restores the window", async () => {
    const page = await open("reflow");
    const found = await measureReflow(page);
    expect(found).toMatchObject([{ kind: "reflow", verdict: "fail", selector: "#wide" }]);
    expect(page.viewportSize()).toEqual({ width: 1280, height: 900 });
    await page.close();
  });

  it("sends a wide data table for a hand check, not a failure", async () => {
    const page = await open("table");
    expect(await measureReflow(page)).toMatchObject([{ kind: "reflow", verdict: "review" }]);
    await page.close();
  });

  it("flags text cut off by wider spacing, and removes the spacing after", async () => {
    const page = await open("spacing");
    expect(await measureTextSpacing(page)).toMatchObject([{ kind: "text-spacing", verdict: "review", selector: "#tight" }]);
    expect(await page.evaluate("!!document.getElementById('legible-text-spacing')")).toBe(false);
    await page.close();
  });

  it("flags a clickable element the keyboard never reaches", async () => {
    const page = await open("reach");
    expect(await measureKeyboardReach(page, ["body > a:nth-of-type(1)"])).toMatchObject([
      { kind: "keyboard-reach", verdict: "review", selector: "#fake" },
    ]);
    await page.close();
  });

  it("finds nothing on the clean page", async () => {
    const page = await open("clean");
    expect([...(await measureReflow(page)), ...(await measureTextSpacing(page)), ...(await measureKeyboardReach(page, []))]).toEqual([]);
    await page.close();
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- measure-layout`
Expected: FAIL (`measureReflow` is not exported).

- [ ] **Step 3: Append to `worker/src/agent/measure.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix worker test -- measure && npm --prefix worker run typecheck`
Expected: PASS for both measure test files.

- [ ] **Step 5: Commit**

```bash
git add worker/src/agent/measure.ts worker/test/measure-layout.test.ts
git commit -m "Agent: measure reflow, text spacing and keyboard reach

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The safety guard

**Files:**
- Create: `worker/src/agent/guard.ts`
- Test: `worker/test/guard.test.ts`

**Interfaces:**
- Produces: `guardPage(page: Page): Promise<() => Promise<void>>`. It returns a function that removes the guard.

- [ ] **Step 1: Write the failing test**

`worker/test/guard.test.ts`:

```ts
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { guardPage } from "../src/agent/guard";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5071;
const base = `http://127.0.0.1:${PORT}`;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

it("never lets the page submit a form or leave the site, and can be removed", async () => {
  const page = await (await getBrowser()).newPage();
  await page.goto(`${base}/agent/post.html`);
  const release = await guardPage(page);
  await page.focus("#send");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await page.focus("#away");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await page.evaluate("alert('hi')"); // dismissed, does not hang
  expect(new URL(page.url()).pathname).toBe("/agent/post.html");
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  expect(await (await fetch(`${base}/__posts`)).text()).toBe("0");
  await release();
  await page.close();
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- guard`
Expected: FAIL (cannot find `../src/agent/guard`).

- [ ] **Step 3: Write `worker/src/agent/guard.ts`**

```ts
// While the agent uses a page, nothing it does may change the customer's
// site: no form posts, logins or purchases, and no leaving the site.
import type { Dialog, Page, Request, Route } from "playwright";

function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}

export async function guardPage(page: Page): Promise<() => Promise<void>> {
  const home = new URL(page.url()).hostname;
  const handler = async (route: Route, request: Request) => {
    const method = request.method();
    if (method !== "GET" && method !== "HEAD") return route.abort("blockedbyclient");
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      let host = "";
      try {
        host = new URL(request.url()).hostname;
      } catch {
        return route.abort("blockedbyclient");
      }
      if (!sameSite(host, home)) return route.abort("blockedbyclient");
    }
    // Hand over to the context's own rules (private addresses, media).
    return route.fallback();
  };
  const onDialog = (d: Dialog) => void d.dismiss().catch(() => {});
  const onPopup = (p: Page) => void p.close().catch(() => {});
  await page.route("**/*", handler);
  page.on("dialog", onDialog);
  page.on("popup", onPopup);
  return async () => {
    page.off("dialog", onDialog);
    page.off("popup", onPopup);
    await page.unroute("**/*", handler).catch(() => {});
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npm --prefix worker test -- guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/agent/guard.ts worker/test/guard.test.ts
git commit -m "Agent: block form posts, logins and leaving the site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The model interface (Claude and a stand-in)

**Files:**
- Create: `worker/src/agent/model.ts`
- Test: `worker/test/model.test.ts`

**Interfaces:**
- Produces:
  - `interface ModelTurn { content: Anthropic.ContentBlock[]; stopReason: string | null; usage: AgentUsage }`
  - `interface ModelRequest { system: string; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[] }`
  - `interface AgentModel { readonly name: string; turn(req: ModelRequest): Promise<ModelTurn> }`
  - `class AnthropicModel implements AgentModel` with `constructor(client?: { messages: { create: Function } }, name?: string)`
  - `class ReplayModel implements AgentModel` with `constructor(script: ReplayStep[])` and `requests: ModelRequest[]`
  - `type ReplayStep = { calls: { name: string; input: Record<string, unknown> }[] } | { refuse: true } | { error: string } | { text: string }`
  - `emptyUsage(): AgentUsage`, `addUsage(a: AgentUsage, b: AgentUsage): AgentUsage`
  - `agentModelFromEnv(): AgentModel | null` (null when there is no key)

- [ ] **Step 1: Write the failing test**

`worker/test/model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AnthropicModel, ReplayModel, addUsage, agentModelFromEnv, emptyUsage } from "../src/agent/model";

const req = { system: "s", tools: [{ name: "look", description: "d", input_schema: { type: "object" as const, properties: {}, required: [], additionalProperties: false } }], messages: [{ role: "user" as const, content: "hi" }] };

describe("ReplayModel", () => {
  it("plays back tool calls, refusals, errors and a final text", async () => {
    const m = new ReplayModel([{ calls: [{ name: "look", input: {} }] }, { refuse: true }, { error: "boom" }, { text: "done" }]);
    const t1 = await m.turn(req);
    expect(t1.stopReason).toBe("tool_use");
    expect(t1.content[0]).toMatchObject({ type: "tool_use", name: "look", input: {} });
    expect((await m.turn(req)).stopReason).toBe("refusal");
    await expect(m.turn(req)).rejects.toThrow("boom");
    expect((await m.turn(req)).stopReason).toBe("end_turn");
    // Past the script: the agent is told it is finished.
    expect((await m.turn(req)).stopReason).toBe("end_turn");
    expect(m.requests.length).toBe(5);
  });
});

describe("AnthropicModel", () => {
  it("sends strict tools, auto tool choice, medium effort and caching, and reads usage", async () => {
    let sent: Record<string, unknown> = {};
    const fake = {
      messages: {
        create: async (body: Record<string, unknown>) => {
          sent = body;
          return {
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
          };
        },
      },
    };
    const m = new AnthropicModel(fake, "claude-sonnet-5-5");
    const t = await m.turn(req);
    expect(sent).toMatchObject({
      model: "claude-sonnet-5-5",
      tool_choice: { type: "auto" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system: "s",
    });
    expect((sent.tools as { strict: boolean }[])[0].strict).toBe(true);
    expect(t.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 20 });
  });
});

describe("usage and setup", () => {
  it("adds usage and needs a key", () => {
    const u = addUsage(emptyUsage(), { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 });
    expect(addUsage(u, u)).toEqual({ inputTokens: 2, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 8 });
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(agentModelFromEnv()).toBeNull();
    if (key) process.env.ANTHROPIC_API_KEY = key;
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- model`
Expected: FAIL (cannot find `../src/agent/model`).

- [ ] **Step 3: Write `worker/src/agent/model.ts`**

```ts
// The agent talks to a model through this interface: Claude in production,
// a replay of recorded answers in tests (no key, no cost, same result).
import Anthropic from "@anthropic-ai/sdk";
import type { AgentUsage } from "../types";

export interface ModelRequest {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
}

export interface ModelTurn {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage: AgentUsage;
}

export interface AgentModel {
  readonly name: string;
  turn(req: ModelRequest): Promise<ModelTurn>;
}

export function emptyUsage(): AgentUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

type Client = { messages: { create: (body: never, options?: never) => Promise<unknown> } };

export class AnthropicModel implements AgentModel {
  constructor(
    private readonly client: Client = new Anthropic(),
    readonly name: string = process.env.AGENT_MODEL || "claude-sonnet-5-5",
  ) {}

  async turn(req: ModelRequest): Promise<ModelTurn> {
    const body = {
      model: this.name,
      max_tokens: 4000,
      // Forced tool choice returns 400 on this model: steer with the prompt,
      // keep inputs schema-valid with strict tools.
      tool_choice: { type: "auto" },
      tools: req.tools.map((t) => ({ ...t, strict: true })),
      output_config: { effort: "medium" },
      // Caches the growing conversation, so each step pays full price only
      // for what is new.
      cache_control: { type: "ephemeral" },
      system: req.system,
      messages: req.messages,
    };
    const res = (await this.client.messages.create(body as never, { timeout: 60_000, maxRetries: 2 } as never)) as Anthropic.Message;
    return {
      content: res.content,
      stopReason: res.stop_reason,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

export type ReplayStep =
  | { calls: { name: string; input: Record<string, unknown> }[] }
  | { refuse: true }
  | { error: string }
  | { text: string };

export class ReplayModel implements AgentModel {
  readonly name = "replay";
  readonly requests: ModelRequest[] = [];
  private n = 0;

  constructor(private readonly script: ReplayStep[]) {}

  async turn(req: ModelRequest): Promise<ModelTurn> {
    this.requests.push(structuredClone(req));
    const step = this.script.shift() ?? { text: "Finished." };
    const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    this.n++;
    if ("error" in step) throw new Error(step.error);
    if ("refuse" in step) return { content: [], stopReason: "refusal", usage };
    if ("text" in step) {
      return { content: [{ type: "text", text: step.text, citations: null } as Anthropic.ContentBlock], stopReason: "end_turn", usage };
    }
    const content = step.calls.map(
      (c, i) => ({ type: "tool_use", id: `toolu_replay_${this.n}_${i}`, name: c.name, input: c.input }) as unknown as Anthropic.ContentBlock,
    );
    return { content, stopReason: "tool_use", usage };
  }
}

export function agentModelFromEnv(): AgentModel | null {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicModel() : null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix worker test -- model && npm --prefix worker run typecheck`
Expected: PASS. If the SDK's types reject a field, keep the `as never` casts on the request and confirm the field names against the claude-api skill's TypeScript README. Do not rename `output_config`, `cache_control` or `strict`.

- [ ] **Step 5: Commit**

```bash
git add worker/src/agent/model.ts worker/test/model.test.ts
git commit -m "Agent: Claude model and a replay stand-in for tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Keyboard actions and prompts

**Files:**
- Create: `worker/src/agent/actions.ts`
- Create: `worker/src/agent/prompts.ts`
- Test: `worker/test/actions.test.ts`

**Interfaces:**
- Consumes: `focusInfoScript`, `SELECTOR_FN` from `./dom`, and `TEXT_SPACING_CSS` from `./measure`.
- Produces:
  - `AGENT_TOOLS: Anthropic.Tool[]` with tools `press`, `type`, `zoom`, `spacing`, `look`, `claim`, `judge`, `done`
  - `KEYS`, `TEST_TEXT`, `CLAIM_KINDS`, `REVIEW_KINDS` (readonly string tuples)
  - `interface ActionState { url: string; zoomed: boolean; spaced: boolean }`
  - `perform(page: Page, name: string, input: unknown, state: ActionState): Promise<{ ok: boolean; text: string; image?: Buffer }>`, for `press`, `type`, `zoom`, `spacing` and `look` only
  - `pageOutlineScript(): string`, which returns a compact outline of headings, images, links, fields and videos with selectors
  - `SYSTEM_PROMPT: string`, `firstMessage(url: string, measured: string[], outline: string, screenshot: Buffer): Anthropic.MessageParam`

- [ ] **Step 1: Write the failing test**

`worker/test/actions.test.ts`:

```ts
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { AGENT_TOOLS, pageOutlineScript, perform, type ActionState } from "../src/agent/actions";
import { SYSTEM_PROMPT, firstMessage } from "../src/agent/prompts";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5072;
const base = `http://127.0.0.1:${PORT}`;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

describe("actions", () => {
  it("presses keys and reports where focus is, with a screenshot", async () => {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    const r = await perform(page, "press", { key: "Tab" }, state);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Focus: a");
    expect(r.text).toContain('"One"');
    expect(r.image?.length).toBeGreaterThan(1000);
    await page.close();
  });

  it("types only from the fixed list, and only into a field", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    expect((await perform(page, "type", { text: "Test name" }, state)).ok).toBe(false); // nothing focused
    await page.focus("#name");
    expect((await perform(page, "type", { text: "my real password" }, state)).ok).toBe(false);
    expect((await perform(page, "type", { text: "Test name" }, state)).ok).toBe(true);
    expect(await page.inputValue("#name")).toBe("Test name");
    await page.close();
  });

  it("zooms and spaces text, then puts both back", async () => {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    await perform(page, "zoom", { on: true }, state);
    expect(page.viewportSize()?.width).toBe(320);
    await perform(page, "spacing", { on: true }, state);
    expect(await page.evaluate("!!document.getElementById('legible-text-spacing')")).toBe(true);
    await perform(page, "zoom", { on: false }, state);
    await perform(page, "spacing", { on: false }, state);
    expect(page.viewportSize()?.width).toBe(1280);
    expect(state).toMatchObject({ zoomed: false, spaced: false });
    await page.close();
  });

  it("comes back when Enter opens another page of the site", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/nav.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    await page.focus("#go");
    const r = await perform(page, "press", { key: "Enter" }, state);
    expect(r.text).toContain("returned to the page under test");
    expect(new URL(page.url()).pathname).toBe("/agent/nav.html");
    await page.close();
  });

  it("refuses unknown actions and bad values", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/clean.html`);
    const state: ActionState = { url: page.url(), zoomed: false, spaced: false };
    expect((await perform(page, "click", {}, state)).ok).toBe(false);
    expect((await perform(page, "press", { key: "F5" }, state)).ok).toBe(false);
    await page.close();
  });

  it("outlines the page with selectors", async () => {
    const page = await (await getBrowser()).newPage();
    await page.goto(`${base}/agent/alt.html`);
    const outline = (await page.evaluate(pageOutlineScript())) as string;
    expect(outline).toContain('#photo | img | alt="image123"');
    expect(outline).toContain('#more | link | "Click here"');
    expect(outline).toContain("h1");
    await page.close();
  });
});

describe("tools and prompts", () => {
  it("defines strict schemas for every tool", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(["press", "type", "zoom", "spacing", "look", "claim", "judge", "done"]);
    for (const t of AGENT_TOOLS) expect(t.input_schema).toMatchObject({ type: "object", additionalProperties: false });
  });
  it("tells the model the rules and sends the page as an image", () => {
    expect(SYSTEM_PROMPT).toContain("keyboard");
    expect(SYSTEM_PROMPT).not.toMatch(/compliant|legally safe/i);
    const m = firstMessage("https://a.example/", ["focus-visible: #x (fail)"], "#x | link | \"Go\"", Buffer.from("jpeg"));
    expect(JSON.stringify(m)).toContain("https://a.example/");
    expect((m.content as { type: string }[]).some((b) => b.type === "image")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- actions`
Expected: FAIL (cannot find `../src/agent/actions`).

- [ ] **Step 3: Write `worker/src/agent/actions.ts`**

```ts
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

function samePage(a: string, b: string): boolean {
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
      await page.keyboard.press(key === "Space" ? "Space" : (key as string));
      await page.waitForTimeout(200);
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
```

- [ ] **Step 4: Write `worker/src/agent/prompts.ts`**

```ts
// The agent's instructions. Kept constant so the model can cache them.
import type Anthropic from "@anthropic-ai/sdk";

export const SYSTEM_PROMPT = `You are Legible's testing agent. You test one web page for accessibility the way a person who cannot use a mouse would, and you report what a disabled person would struggle with.

What you can do: press keys, type test text into the focused field, turn 400% zoom on and off, turn wider text spacing on and off, and look. You cannot click. You only see the page through screenshots, the focus line after each action and the page outline.

Rules:
- Use the keyboard only. Never try to submit a form, sign in, buy or change anything. Such requests are blocked anyway.
- Legible has already measured, on the page as it loaded: keyboard traps, whether focus is visible at every Tab stop, sideways scrolling at 400% zoom, text cut off by wider spacing, and clickable things the keyboard cannot reach. The list is in the first message. Do not repeat those.
- Spend your actions on what those measurements miss: menus, dropdowns, dialogs, tabs, accordions and carousels that open or change when used. Open them with Enter, Space or the arrow keys, then Tab through what appears.
- Use claim when, in a state you opened, focus gets stuck (keyboard-trap) or you cannot see where focus is (focus-visible). Name the element with the selector from the focus line. Legible measures every claim and reports only what it can prove.
- Use judge for problems that need judgement, one element at a time, only when it is clearly a problem for a disabled person:
  image-description: the alt text does not describe what the image shows or means.
  link-purpose: a link or button's words, with the sentence around them, do not say where it goes or what it does.
  heading-fit: a heading does not describe the section under it.
  error-help: an error message on the page does not say how to fix the problem.
  captions: a video has no captions or transcript in sight.
  Give the selector from the outline or the focus line, and a reason of one or two short sentences in plain English.
- You have at most 20 actions. When you have checked what matters, call done with one sentence.`;

export function firstMessage(url: string, measured: string[], outline: string, screenshot: Buffer): Anthropic.MessageParam {
  const already = measured.length ? measured.map((m) => `- ${m}`).join("\n") : "- Nothing found.";
  return {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshot.toString("base64") } },
      {
        type: "text",
        text: `Page under test: ${url}\n\nAlready measured by Legible:\n${already}\n\nPage outline (selector | what it is):\n${outline || "(empty)"}\n\nStart testing. The screenshot shows the page as it loaded, 1280 pixels wide.`,
      },
    ],
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix worker test -- actions && npm --prefix worker run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/agent/actions.ts worker/src/agent/prompts.ts worker/test/actions.test.ts
git commit -m "Agent: keyboard actions, page outline and instructions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The second opinion on judgement findings

**Files:**
- Create: `worker/src/agent/review.ts`
- Test: `worker/test/review.test.ts`

**Interfaces:**
- Consumes: `AgentModel`, `ModelTurn` from `./model`; `elementInfoScript` from `./dom`; `REVIEW_KINDS` from `./actions`.
- Produces: `secondOpinion(model: AgentModel, page: Page, j: { kind: AgentReviewKind; selector: string; reason: string }): Promise<{ review: AgentReview | null; shot?: Buffer; usage: AgentUsage }>` and `REVIEW_PROMPT: string`.

- [ ] **Step 1: Write the failing test**

`worker/test/review.test.ts`:

```ts
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { secondOpinion } from "../src/agent/review";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5073;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

it("keeps a finding only when the second pass agrees, using the page's real code", async () => {
  const page = await (await getBrowser()).newPage();
  await page.goto(`http://127.0.0.1:${PORT}/agent/alt.html`);
  const agree = new ReplayModel([{ calls: [{ name: "verdict", input: { problem: true, reason: "The alt text is a file name, not a description." } }] }]);
  const kept = await secondOpinion(agree, page, { kind: "image-description", selector: "#photo", reason: "Alt is image123" });
  expect(kept.review).toMatchObject({ kind: "image-description", selector: "#photo", reason: "The alt text is a file name, not a description." });
  expect(kept.review!.html).toContain('alt="image123"');
  expect(kept.shot?.length).toBeGreaterThan(100);
  // The second pass saw the element's code and a picture of it.
  const sent = JSON.stringify(agree.requests[0].messages);
  expect(sent).toContain("image123");
  expect(sent).toContain('"type":"image"');

  const disagree = new ReplayModel([{ calls: [{ name: "verdict", input: { problem: false, reason: "Fine." } }] }]);
  expect((await secondOpinion(disagree, page, { kind: "link-purpose", selector: "#more", reason: "Click here" })).review).toBeNull();

  const silent = new ReplayModel([{ text: "I am not sure." }]);
  expect((await secondOpinion(silent, page, { kind: "link-purpose", selector: "#more", reason: "x" })).review).toBeNull();

  const missing = new ReplayModel([]);
  expect((await secondOpinion(missing, page, { kind: "link-purpose", selector: "#nope", reason: "x" })).review).toBeNull();
  expect(missing.requests.length).toBe(0); // no element, no model call
  await page.close();
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- review`
Expected: FAIL (cannot find `../src/agent/review`).

- [ ] **Step 3: Write `worker/src/agent/review.ts`**

```ts
// A fresh, independent look at each judgement finding: a different prompt,
// no conversation history, the element's real code and a picture of it. A
// finding is kept only when this pass also says it is a problem.
import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { AgentReview, AgentReviewKind, AgentUsage } from "../types";
import { elementInfoScript } from "./dom";
import { emptyUsage, type AgentModel } from "./model";

export const REVIEW_PROMPT = `You are a careful accessibility reviewer. Another reviewer flagged one element on a web page. Decide on your own whether it is a real problem for a disabled person under WCAG 2.1 Level AA. Answer with the verdict tool. Say problem: false when you are not sure. Keep the reason to one or two short sentences in plain English, written for a small business owner.`;

const VERDICT_TOOL: Anthropic.Tool = {
  name: "verdict",
  description: "Your decision on the flagged element.",
  input_schema: {
    type: "object",
    properties: { problem: { type: "boolean" }, reason: { type: "string" } },
    required: ["problem", "reason"],
    additionalProperties: false,
  },
};

const QUESTION: Record<AgentReviewKind, string> = {
  "image-description": "Does this image's alt text fail to describe what the image shows or means?",
  "link-purpose": "Do this link or button's words, with the text around them, fail to say where it goes or what it does?",
  "heading-fit": "Does this heading fail to describe the section it starts?",
  "error-help": "Does this error message fail to say how to fix the problem?",
  captions: "Does this video lack captions or a transcript?",
};

type Info = { html: string; text: string; around: string; alt: string | null; tag: string };

export async function secondOpinion(
  model: AgentModel,
  page: Page,
  j: { kind: AgentReviewKind; selector: string; reason: string },
): Promise<{ review: AgentReview | null; shot?: Buffer; usage: AgentUsage }> {
  const info = (await page.evaluate(elementInfoScript(j.selector)).catch(() => null)) as Info | null;
  if (!info || !QUESTION[j.kind]) return { review: null, usage: emptyUsage() };
  const el = page.locator(j.selector).first();
  await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const shot = await el.screenshot({ type: "jpeg", quality: 70, timeout: 5000 }).catch(() => undefined);
  const content: Anthropic.ContentBlockParam[] = [];
  if (shot) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: shot.toString("base64") } });
  content.push({
    type: "text",
    text: `${QUESTION[j.kind]}\n\nElement code:\n${info.html}\n\nIts text: "${info.text}"\nText around it: "${info.around}"${info.alt !== null ? `\nAlt text: "${info.alt}"` : ""}\n\nThe first reviewer said: ${j.reason}`,
  });
  const turn = await model.turn({ system: REVIEW_PROMPT, tools: [VERDICT_TOOL], messages: [{ role: "user", content }] });
  const call = turn.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "verdict");
  const input = call?.input as { problem?: unknown; reason?: unknown } | undefined;
  if (!input || input.problem !== true || typeof input.reason !== "string" || !input.reason.trim()) {
    return { review: null, shot, usage: turn.usage };
  }
  return {
    review: { kind: j.kind, selector: j.selector, html: info.html, reason: input.reason.trim().slice(0, 400) },
    shot,
    usage: turn.usage,
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npm --prefix worker test -- review`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/agent/review.ts worker/test/review.test.ts
git commit -m "Agent: a second, independent check of judgement findings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The agent on one page

**Files:**
- Create: `worker/src/agent/run.ts`
- Test: `worker/test/run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 to 9.
- Produces:
  - `MAX_STEPS = 20`, `LOOP_MS = 90_000`, `AGENT_BUDGET_MS = 180_000`
  - `interface AgentOptions { model: AgentModel; maxSteps?: number; loopMs?: number; budgetMs?: number; onShot?: (id: string, jpeg: Buffer) => void | Promise<void> }`
  - `interface AgentOutcome { result: AgentPageResult; violations: RawRule[]; incomplete: RawRule[]; passes: { id: string; nodeCount: number }[] }`
  - `runAgentOnPage(page: Page, opts: AgentOptions): Promise<AgentOutcome>`

- [ ] **Step 1: Write the failing test**

`worker/test/run.test.ts`:

```ts
import type { Server } from "node:http";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { runAgentOnPage } from "../src/agent/run";
import { closeBrowser, getBrowser } from "../src/scan";

const PORT = 5074;
let server: Server;
beforeAll(async () => {
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

async function open(name: string): Promise<Page> {
  const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/agent/${name}.html`);
  return page;
}

describe("runAgentOnPage", () => {
  it("turns measurements into failures, hand checks and passes", async () => {
    const page = await open("focus");
    const shots: string[] = [];
    const out = await runAgentOnPage(page, { model: new ReplayModel([{ calls: [{ name: "done", input: { summary: "ok" } }] }]), onShot: (id) => void shots.push(id) });
    expect(out.violations.map((v) => v.id)).toEqual(["legible-focus-visible"]);
    expect(out.violations[0]).toMatchObject({ impact: "serious", tags: ["wcag2aa", "wcag247"], nodeCount: 1 });
    expect(out.violations[0].nodes[0].shot).toBe(shots[0]);
    expect(out.passes.map((p) => p.id).sort()).toEqual(["legible-keyboard-trap", "legible-reflow"]);
    expect(out.result).toMatchObject({ status: "tested", steps: 1 });
    await page.close();
  });

  it("keeps a judgement only when the second pass agrees", async () => {
    const page = await open("alt");
    const model = new ReplayModel([
      { calls: [{ name: "judge", input: { kind: "image-description", selector: "#photo", reason: "File name as alt." } }, { name: "judge", input: { kind: "link-purpose", selector: "#more", reason: "Click here." } }] },
      { calls: [{ name: "done", input: { summary: "ok" } }] },
      { calls: [{ name: "verdict", input: { problem: true, reason: "The alt text is a file name." } }] },
      { calls: [{ name: "verdict", input: { problem: false, reason: "Clear enough in context." } }] },
    ]);
    const out = await runAgentOnPage(page, { model });
    expect(out.result.reviews.map((r) => [r.kind, r.selector])).toEqual([["image-description", "#photo"]]);
    expect(out.result.usage.inputTokens).toBe(400); // 4 model calls of 100
    await page.close();
  });

  it("measures a claim, and drops it when the measurement disagrees", async () => {
    const page = await open("clean");
    const model = new ReplayModel([
      { calls: [{ name: "claim", input: { kind: "keyboard-trap", selector: "#name", note: "stuck" } }] },
      { calls: [{ name: "claim", input: { kind: "focus-visible", selector: "#does-not-exist", note: "?" } }] },
      { calls: [{ name: "done", input: { summary: "ok" } }] },
    ]);
    const out = await runAgentOnPage(page, { model });
    expect(out.violations).toEqual([]);
    expect(out.incomplete).toEqual([]);
    const toolResults = JSON.stringify(model.requests[1].messages.at(-1));
    expect(toolResults).toContain("not reported");
    await page.close();
  });

  it("refuses unknown tools and bad input without crashing", async () => {
    const page = await open("clean");
    const model = new ReplayModel([
      { calls: [{ name: "click", input: { x: 1 } }, { name: "press", input: { key: "F12" } }] },
      { calls: [{ name: "done", input: { summary: "ok" } }] },
    ]);
    const out = await runAgentOnPage(page, { model });
    expect(out.result).toMatchObject({ status: "tested", steps: 3 });
    expect(JSON.stringify(model.requests[1].messages.at(-1))).toContain('"is_error":true');
    await page.close();
  });

  it("stops at the step limit, keeps measurements, and marks the page partly tested", async () => {
    const page = await open("reflow");
    const press = { calls: [{ name: "press", input: { key: "Tab" } }] };
    const out = await runAgentOnPage(page, { model: new ReplayModel([press, press, press, press]), maxSteps: 3 });
    expect(out.result).toMatchObject({ status: "partly", reason: "step limit", steps: 3 });
    expect(out.violations.map((v) => v.id)).toEqual(["legible-reflow"]);
    await page.close();
  });

  it("survives a model error and a refusal", async () => {
    let page = await open("trap");
    let out = await runAgentOnPage(page, { model: new ReplayModel([{ error: "overloaded" }]) });
    expect(out.result).toMatchObject({ status: "failed", reason: "model error" });
    expect(out.violations.map((v) => v.id)).toEqual(["legible-keyboard-trap"]); // measured anyway
    await page.close();
    page = await open("clean");
    out = await runAgentOnPage(page, { model: new ReplayModel([{ refuse: true }]) });
    expect(out.result).toMatchObject({ status: "failed", reason: "declined" });
    await page.close();
  });

  it("restores the window and the guard afterwards", async () => {
    const page = await open("clean");
    await runAgentOnPage(page, { model: new ReplayModel([{ calls: [{ name: "zoom", input: { on: true } }] }, { calls: [{ name: "done", input: { summary: "ok" } }] }]) });
    expect(page.viewportSize()).toEqual({ width: 1280, height: 900 });
    expect(await page.evaluate("!!document.getElementById('legible-text-spacing')")).toBe(false);
    await page.close();
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- run.test`
Expected: FAIL (cannot find `../src/agent/run`).

- [ ] **Step 3: Write `worker/src/agent/run.ts`**

```ts
// The testing agent on one page: measure what can be proven, let the model
// use the page with the keyboard, confirm its claims by measurement, give
// its judgements a second opinion, and turn it all into rules the report
// already understands.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { AgentPageResult, AgentReview, AgentReviewKind, RawNode, RawRule } from "../types";
import { AGENT_TOOLS, CLAIM_KINDS, REVIEW_KINDS, pageOutlineScript, perform, type ActionState } from "./actions";
import { guardPage } from "./guard";
import { keyboardWalk, measureFocusAt, measureKeyboardReach, measureReflow, measureTextSpacing, trapFrom, type Measured, type MeasuredKind } from "./measure";
import { addUsage, emptyUsage, type AgentModel } from "./model";
import { SYSTEM_PROMPT, firstMessage } from "./prompts";
import { secondOpinion } from "./review";

export const MAX_STEPS = 20;
export const LOOP_MS = 90_000;
export const AGENT_BUDGET_MS = 180_000;
const MAX_REVIEWS = 10;
const SHOTS_PER_KIND = 3;
const WIDE = { width: 1280, height: 900 };

const UNDERSTANDING = "https://www.w3.org/WAI/WCAG21/Understanding/";
const RULES: Record<MeasuredKind, { impact: string; tags: string[]; help: string; slug: string }> = {
  "keyboard-trap": { impact: "critical", tags: ["wcag2a", "wcag212"], help: "Keyboard focus gets stuck", slug: "no-keyboard-trap" },
  "focus-visible": { impact: "serious", tags: ["wcag2aa", "wcag247"], help: "You cannot see where keyboard focus is", slug: "focus-visible" },
  reflow: { impact: "serious", tags: ["wcag21aa", "wcag1410"], help: "The page needs sideways scrolling at 400% zoom", slug: "reflow" },
  "keyboard-reach": { impact: "serious", tags: ["wcag2a", "wcag211"], help: "Something clickable cannot be reached with the keyboard", slug: "keyboard" },
  "text-spacing": { impact: "moderate", tags: ["wcag21aa", "wcag1412"], help: "Text is cut off when spacing is increased", slug: "text-spacing" },
};
// Measurements that can prove a failure. A page where they ran and found
// nothing passes them, so the score counts them like axe-core rules.
const SCORED: MeasuredKind[] = ["keyboard-trap", "focus-visible", "reflow"];

export interface AgentOptions {
  model: AgentModel;
  maxSteps?: number;
  loopMs?: number;
  budgetMs?: number;
  onShot?: (id: string, jpeg: Buffer) => void | Promise<void>;
}

export interface AgentOutcome {
  result: AgentPageResult;
  violations: RawRule[];
  incomplete: RawRule[];
  passes: { id: string; nodeCount: number }[];
}

function summaryLine(m: Measured): string {
  return `${m.kind}: ${m.selector} (${m.verdict === "fail" ? "failure" : "check by hand"})`;
}

// One finding per kind and element; a failure beats a hand check.
function dedupe(found: Measured[]): Measured[] {
  const byKey = new Map<string, Measured>();
  for (const m of found) {
    const key = `${m.kind}\u0000${m.selector}`;
    const had = byKey.get(key);
    if (!had || (had.verdict === "review" && m.verdict === "fail")) byKey.set(key, m);
  }
  return [...byKey.values()];
}

async function toRules(found: Measured[], onShot: AgentOptions["onShot"]) {
  const violations: RawRule[] = [];
  const incomplete: RawRule[] = [];
  for (const verdict of ["fail", "review"] as const) {
    for (const kind of Object.keys(RULES) as MeasuredKind[]) {
      const hits = found.filter((m) => m.kind === kind && m.verdict === verdict);
      if (!hits.length) continue;
      const r = RULES[kind];
      const nodes: RawNode[] = [];
      for (const [i, m] of hits.entries()) {
        const node: RawNode = { html: m.html, target: [m.selector], failureSummary: m.detail, impact: r.impact };
        if (m.shot && onShot && i < SHOTS_PER_KIND) {
          node.shot = randomUUID();
          await onShot(node.shot, m.shot);
        }
        nodes.push(node);
      }
      const rule: RawRule = {
        id: `legible-${kind}`,
        impact: r.impact,
        help: r.help,
        description: r.help,
        helpUrl: `${UNDERSTANDING}${r.slug}.html`,
        tags: r.tags,
        nodeCount: nodes.length,
        nodes,
      };
      (verdict === "fail" ? violations : incomplete).push(rule);
    }
  }
  const failed = new Set(violations.map((v) => v.id));
  const passes = SCORED.map((k) => `legible-${k}`)
    .filter((id) => !failed.has(id))
    .map((id) => ({ id, nodeCount: 1 }));
  return { violations, incomplete, passes };
}

export async function runAgentOnPage(page: Page, opts: AgentOptions): Promise<AgentOutcome> {
  const started = Date.now();
  const budgetEnd = started + (opts.budgetMs ?? AGENT_BUDGET_MS);
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  const url = page.url();
  let usage = emptyUsage();
  const found: Measured[] = [];
  const judged: { kind: AgentReviewKind; selector: string; reason: string }[] = [];
  const reviews: AgentReview[] = [];
  let steps = 0;
  let status: AgentPageResult["status"] = "tested";
  let reason: string | undefined;
  const state: ActionState = { url, zoomed: false, spaced: false };
  const release = await guardPage(page);
  try {
    // 1. Measure what can be proven on the page as it loaded.
    const walk = await keyboardWalk(page);
    found.push(...walk.findings);
    found.push(...(await measureKeyboardReach(page, walk.reached)));
    found.push(...(await measureReflow(page)));
    found.push(...(await measureTextSpacing(page)));
    await page.evaluate("document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0)");

    // 2. Let the model use the page.
    const loopEnd = Math.min(budgetEnd, Date.now() + (opts.loopMs ?? LOOP_MS));
    const outline = (await page.evaluate(pageOutlineScript()).catch(() => "")) as string;
    const messages: Anthropic.MessageParam[] = [
      firstMessage(url, dedupe(found).map(summaryLine), outline, await page.screenshot({ type: "jpeg", quality: 60 })),
    ];
    loop: while (true) {
      if (Date.now() >= loopEnd) {
        status = "partly";
        reason = "time limit";
        break;
      }
      let turn;
      try {
        turn = await opts.model.turn({ system: SYSTEM_PROMPT, tools: AGENT_TOOLS, messages });
      } catch {
        status = "failed";
        reason = "model error";
        break;
      }
      usage = addUsage(usage, turn.usage);
      if (turn.stopReason === "refusal") {
        status = "failed";
        reason = "declined";
        break;
      }
      const calls = turn.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!calls.length) break;
      messages.push({ role: "assistant", content: turn.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        if (steps >= maxSteps) {
          status = "partly";
          reason = "step limit";
          break loop;
        }
        steps++;
        const input = (call.input ?? {}) as Record<string, unknown>;
        if (call.name === "done") break loop;
        if (call.name === "claim") {
          const kind = input.kind as string;
          const selector = typeof input.selector === "string" ? input.selector : "";
          let m: Measured | null = null;
          if (kind === "focus-visible") m = await measureFocusAt(page, selector);
          else if (kind === "keyboard-trap") m = await trapFrom(page, selector);
          if (!CLAIM_KINDS.includes(kind as (typeof CLAIM_KINDS)[number])) {
            results.push({ type: "tool_result", tool_use_id: call.id, content: `Unknown claim kind: ${kind}.`, is_error: true });
          } else if (m) {
            found.push(m);
            results.push({ type: "tool_result", tool_use_id: call.id, content: `Measured and confirmed: ${m.detail}` });
          } else {
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Measured: the problem could not be proven there, so it is not reported." });
          }
          continue;
        }
        if (call.name === "judge") {
          const kind = input.kind as AgentReviewKind;
          if (!REVIEW_KINDS.includes(kind) || typeof input.selector !== "string" || typeof input.reason !== "string") {
            results.push({ type: "tool_result", tool_use_id: call.id, content: "judge needs a listed kind, a selector and a reason.", is_error: true });
          } else {
            judged.push({ kind, selector: input.selector, reason: input.reason });
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Noted. A second check will decide whether it is reported." });
          }
          continue;
        }
        const r = await perform(page, call.name, input, state);
        const content: Anthropic.ToolResultBlockParam["content"] = [{ type: "text", text: r.text }];
        if (r.image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.image.toString("base64") } });
        results.push({ type: "tool_result", tool_use_id: call.id, content, ...(r.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
    }

    // 3. Put the page back as it loaded, then the second opinions.
    if (state.zoomed) await page.setViewportSize(WIDE).catch(() => {});
    await page.evaluate("(function () { var s = document.getElementById('legible-text-spacing'); if (s) s.remove(); })()").catch(() => {});
    if (status !== "failed") {
      const seen = new Set<string>();
      for (const j of judged) {
        const key = `${j.kind}\u0000${j.selector}`;
        if (seen.has(key) || seen.size >= MAX_REVIEWS || Date.now() >= budgetEnd) continue;
        seen.add(key);
        try {
          const op = await secondOpinion(opts.model, page, j);
          usage = addUsage(usage, op.usage);
          if (op.review) {
            if (op.shot && opts.onShot) {
              op.review.shot = randomUUID();
              await opts.onShot(op.review.shot, op.shot);
            }
            reviews.push(op.review);
          }
        } catch {
          // A failed second opinion means the finding is not confirmed.
        }
      }
    }
  } finally {
    if (state.zoomed) await page.setViewportSize(WIDE).catch(() => {});
    await release();
  }
  const rules = await toRules(dedupe(found), opts.onShot);
  return { result: { status, ...(reason ? { reason } : {}), steps, reviews, usage }, ...rules };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm --prefix worker test -- run.test && npm --prefix worker run typecheck`
Expected: PASS. In "refuses unknown tools", the steps are 3: `click`, `press F12` and `done` each count one.

- [ ] **Step 5: Commit**

```bash
git add worker/src/agent/run.ts worker/test/run.test.ts
git commit -m "Agent: test one page, confirm every claim, keep agreed judgements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The scanner uses the agent

**Files:**
- Modify: `worker/src/scan.ts` (`scanPage`, `ScanOptions`, `scanSite`)
- Modify: `worker/src/server.ts` (the `/jobs/scan` body takes `agent`, and shots are sent in batches before `complete`)
- Modify: `worker/src/cli.ts` (`--agent`)
- Test: `worker/test/scan-agent.test.ts`

**Interfaces:**
- Consumes: `runAgentOnPage`, `AGENT_BUDGET_MS` from `./agent/run`; `AgentModel`, `addUsage`, `emptyUsage`, `agentModelFromEnv` from `./agent/model`.
- Produces: `ScanOptions.agent?: AgentModel`, `ScanOptions.onShot?: (id: string, jpeg: Buffer) => void | Promise<void>`. Callback message `{ type: "shots", shots: { id: string; data: string }[] }`, where `data` is base64 JPEG and each batch is at most 900,000 characters.

- [ ] **Step 1: Write the failing test**

`worker/test/scan-agent.test.ts`:

```ts
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
// @ts-expect-error plain ESM helper without types
import { serveFixture } from "../../tests/fixtures/serve.mjs";
import { ReplayModel } from "../src/agent/model";
import { closeBrowser, scanSite } from "../src/scan";

const PORT = 5075;
let server: Server;
beforeAll(async () => {
  process.env.ALLOW_PRIVATE_TARGETS = "1";
  server = await serveFixture(PORT);
});
afterAll(async () => {
  await closeBrowser();
  server.close();
  delete process.env.ALLOW_PRIVATE_TARGETS;
});

it("adds the agent's findings to each page and totals its usage", async () => {
  const shots: string[] = [];
  const done = { calls: [{ name: "done", input: { summary: "ok" } }] };
  const raw = await scanSite(`http://127.0.0.1:${PORT}/agent/focus.html`, {
    pauseMs: 10,
    agent: new ReplayModel([done, done, done, done, done, done]),
    onShot: (id) => void shots.push(id),
  });
  const home = raw.pages[0];
  expect(home.violations.map((v) => v.id)).toContain("legible-focus-visible");
  expect(home.passes.map((p) => p.id)).toContain("legible-reflow");
  expect(home.agent).toMatchObject({ status: "tested" });
  expect(raw.agent).toMatchObject({ model: "replay" });
  expect(raw.agent!.usage.inputTokens).toBeGreaterThan(0);
  expect(shots.length).toBeGreaterThan(0);
});

it("leaves scans exactly as before without an agent", async () => {
  const raw = await scanSite(`http://127.0.0.1:${PORT}/agent/focus.html`, { pauseMs: 10 });
  expect(raw.pages[0].violations.some((v) => v.id.startsWith("legible-"))).toBe(false);
  expect(raw.pages[0].agent).toBeUndefined();
  expect(raw.agent).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npm --prefix worker test -- scan-agent`
Expected: FAIL (`agent` is ignored, so `legible-focus-visible` is missing).

- [ ] **Step 3: Change `worker/src/scan.ts`**

Add these imports:

```ts
import { addUsage, emptyUsage, type AgentModel } from "./agent/model";
import { AGENT_BUDGET_MS, runAgentOnPage } from "./agent/run";
```

Extend `ScanOptions`:

```ts
export interface ScanOptions {
  onProgress?: (done: number, total: number) => void | Promise<void>;
  pauseMs?: number;
  // The testing agent: runs on every page after axe-core when given.
  agent?: AgentModel;
  onShot?: (id: string, jpeg: Buffer) => void | Promise<void>;
}
```

Change `scanPage` to take the options:

```ts
async function scanPage(context: BrowserContext, url: string, first: boolean, opts: ScanOptions = {}) {
```

Inside `scanPage`, after `await addFrameHosts(page, raw.violations);`, add:

```ts
        if (opts.agent) {
          const outcome = await runAgentOnPage(page, { model: opts.agent, onShot: opts.onShot });
          raw.violations.push(...outcome.violations);
          raw.incomplete.push(...outcome.incomplete);
          raw.passes.push(...outcome.passes);
          raw.agent = outcome.result;
        }
```

Change its timeout argument from `PAGE_TIMEOUT_MS + 5000,` to:

```ts
      PAGE_TIMEOUT_MS + 5000 + (opts.agent ? AGENT_BUDGET_MS + 30_000 : 0),
```

In `scanSite`, pass the options to both calls: `scanPage(context, start.toString(), true, opts)` and `scanPage(context, link, false, opts)`. At the end, build the return value with the total usage:

```ts
  const raw: RawScan = {
    version: 1,
    startUrl: start.toString(),
    finalUrl,
    engine: { axe: axeCore.version, userAgent: ua },
    startedAt,
    finishedAt: new Date().toISOString(),
    pages,
  };
  if (opts.agent) {
    raw.agent = {
      model: opts.agent.name,
      usage: pages.reduce((u, p) => (p.agent ? addUsage(u, p.agent.usage) : u), emptyUsage()),
    };
  }
  return fitPayload(raw);
```

Add `RawScan` to the existing `import type { … } from "./types"` line.

- [ ] **Step 4: Change `worker/src/server.ts`**

Import the agent at the top:

```ts
import { agentModelFromEnv } from "./agent/model";
```

In `/jobs/scan`, read the flag after the existing body checks:

```ts
  // Only when the site asks and a key is set. The site starts asking in
  // phase 2, once its daily spending cap is in place.
  const agent = req.body?.agent === true ? agentModelFromEnv() : null;
```

Replace the job body's scan and completion with:

```ts
    try {
      const shots: { id: string; data: string }[] = [];
      const raw = await scanSite(target.toString(), {
        onProgress: (done, total) => callback(cb.toString(), { type: "progress", pagesDone: done, pagesTotal: total }),
        ...(agent ? { agent, onShot: (id: string, jpeg: Buffer) => void shots.push({ id, data: jpeg.toString("base64") }) } : {}),
      });
      // Screenshots go first, in batches small enough for one request each.
      let batch: typeof shots = [];
      let size = 0;
      for (const s of shots) {
        if (batch.length && size + s.data.length > 900_000) {
          await callback(cb.toString(), { type: "shots", shots: batch });
          batch = [];
          size = 0;
        }
        batch.push(s);
        size += s.data.length;
      }
      if (batch.length) await callback(cb.toString(), { type: "shots", shots: batch });
      await callback(cb.toString(), { type: "complete", raw });
      console.log(`[scan] ${target.host} done in ${Date.now() - started} ms${agent ? " with the agent" : ""}`);
    } catch (e) {
```

Leave the `catch` branch as it is.

- [ ] **Step 5: Change `worker/src/cli.ts`**

```ts
// `npm run scan -- https://example.com` scans one site and prints a summary.
// Add --agent to run the testing agent too (needs ANTHROPIC_API_KEY in .env).
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { agentModelFromEnv } from "./agent/model";
import { closeBrowser, scanSite } from "./scan";

const url = process.argv.find((a) => /^https?:\/\//.test(a));
const wantAgent = process.argv.includes("--agent");
if (!url) {
  console.error("Usage: npm run scan -- https://example.com [--agent]");
  process.exit(1);
}
const agent = wantAgent ? agentModelFromEnv() : null;
if (wantAgent && !agent) {
  console.error("--agent needs ANTHROPIC_API_KEY in worker/.env");
  process.exit(1);
}
const shotDir = path.join(tmpdir(), "legible-shots");
if (agent) mkdirSync(shotDir, { recursive: true });

const started = Date.now();
try {
  const raw = await scanSite(url, {
    onProgress: (d, t) => console.log(`page ${d} of ${t}`),
    ...(agent ? { agent, onShot: (id: string, jpeg: Buffer) => writeFileSync(path.join(shotDir, `${id}.jpg`), jpeg) } : {}),
  });
  const summary = raw.pages.map((p) => ({
    url: p.url,
    status: p.status,
    reason: p.reason,
    violations: p.violations.map((v) => `${v.id} (${v.impact}, ${v.nodeCount})`),
    checkByHand: p.incomplete.filter((v) => v.id.startsWith("legible-")).map((v) => `${v.id} (${v.nodeCount})`),
    agent: p.agent && { status: p.agent.status, reason: p.agent.reason, steps: p.agent.steps, reviews: p.agent.reviews.map((r) => `${r.kind} ${r.selector}: ${r.reason}`) },
  }));
  console.log(JSON.stringify({ seconds: (Date.now() - started) / 1000, engine: raw.engine, agent: raw.agent, shots: agent ? shotDir : undefined, pages: summary }, null, 2));
} catch (e) {
  console.error("Scan failed:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
```

- [ ] **Step 6: Run all worker tests and the typecheck**

Run: `npm --prefix worker test && npm --prefix worker run typecheck`
Expected: every test PASSES, including the original `scanSite` test (no agent, unchanged results).

- [ ] **Step 7: Commit**

```bash
git add worker/src/scan.ts worker/src/server.ts worker/src/cli.ts worker/test/scan-agent.test.ts
git commit -m "Scanner: run the testing agent when asked, send its screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The report knows the agent's rules

**Files:**
- Modify: `src/lib/rules/wcag.ts` (add 1.4.10, 2.1.2 and 2.4.7)
- Modify: `src/lib/rules/catalogue.ts` (five entries)
- Modify: `tests/unit/catalogue.test.ts`

**Interfaces:**
- Produces: `CATALOGUE["legible-keyboard-trap" | "legible-focus-visible" | "legible-reflow" | "legible-keyboard-reach" | "legible-text-spacing"]`, and `AGENT_RULE_IDS` exported from `catalogue.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/catalogue.test.ts`, inside the `describe`, and add `AGENT_RULE_IDS` to the import from `@/lib/rules/catalogue`:

```ts
  it("explains every rule Legible's testing agent can report, with its WCAG criterion", () => {
    expect(AGENT_RULE_IDS).toEqual([
      "legible-keyboard-trap",
      "legible-focus-visible",
      "legible-reflow",
      "legible-keyboard-reach",
      "legible-text-spacing",
    ]);
    for (const id of AGENT_RULE_IDS) expect(CATALOGUE[id], id).toBeDefined();
    expect(criteriaFromTags(["wcag2a", "wcag212"])).toEqual(["2.1.2"]);
    expect(criteriaFromTags(["wcag2aa", "wcag247"])).toEqual(["2.4.7"]);
    expect(criteriaFromTags(["wcag21aa", "wcag1410"])).toEqual(["1.4.10"]);
    expect(understandingUrl("2.1.2")).toBe("https://www.w3.org/WAI/WCAG21/Understanding/no-keyboard-trap.html");
  });
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run tests/unit/catalogue.test.ts`
Expected: FAIL (`AGENT_RULE_IDS` is not exported).

- [ ] **Step 3: Add the criteria to `src/lib/rules/wcag.ts`**

Insert these in number order in `WCAG`:

```ts
  "1.4.10": { name: "Reflow", level: "AA", version: "2.1" },
  "2.1.2": { name: "No Keyboard Trap", level: "A", version: "2.0" },
  "2.4.7": { name: "Focus Visible", level: "AA", version: "2.0" },
```

Put `"1.4.10"` after `"1.4.4"`, `"2.1.2"` after `"2.1.1"`, and `"2.4.7"` after `"2.4.4"`.

- [ ] **Step 4: Add the catalogue entries to `src/lib/rules/catalogue.ts`**

After the `CATALOGUE` object, add the ids. Then add the five entries inside `CATALOGUE`, in alphabetical position like the others or at the end; keep the house style.

```ts
// Rules measured by Legible's own testing agent (worker/src/agent), not by
// axe-core. Their wording follows the same rules as the rest of the file.
export const AGENT_RULE_IDS = [
  "legible-keyboard-trap",
  "legible-focus-visible",
  "legible-reflow",
  "legible-keyboard-reach",
  "legible-text-spacing",
] as const;
```

```ts
  "legible-keyboard-trap": {
    title: "Keyboard focus gets stuck",
    summary: "Once the keyboard moves into this part of the page, Tab, Shift+Tab and Escape cannot move it out again.",
    why: "People who cannot use a mouse are stuck. They cannot reach the rest of the page, and often have to reload it or give up.",
    who: "People who use a keyboard, switch device or screen reader",
    fix: "Let Tab and Shift+Tab move out of the widget. If it is a dialog, close it with Escape and return focus to the button that opened it.",
    impact: "critical",
    effort: "moderate",
    before: "widget.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); next().focus(); } });",
    after: "// Only keep focus inside an open modal dialog, and close it on Escape.\ndialog.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });",
  },
  "legible-focus-visible": {
    title: "You cannot see where keyboard focus is",
    summary: "When this element receives keyboard focus, nothing on screen changes.",
    why: "People using a keyboard cannot tell which link or button they are on, so they press the wrong one or get lost.",
    who: "People who use a keyboard, including many with low vision or tremors",
    fix: "Give focused elements a clear outline. Do not remove the browser's own outline unless you replace it with one at least as visible.",
    impact: "serious",
    effort: "quick",
    before: "a:focus { outline: none; }",
    after: "a:focus-visible { outline: 3px solid #1a4fd6; outline-offset: 2px; }",
  },
  "legible-reflow": {
    title: "The page needs sideways scrolling at 400% zoom",
    summary: "At 400% zoom, content is wider than the window, so people must scroll left and right to read each line.",
    why: "People who zoom in to read lose their place on every line and can miss content off to the side.",
    who: "People with low vision who zoom in",
    fix: "Let content fit the window: use max-width instead of fixed widths, and let rows wrap at narrow widths.",
    impact: "serious",
    effort: "moderate",
    before: '<div style="width: 900px">…</div>',
    after: '<div style="max-width: 900px">…</div>',
  },
  "legible-keyboard-reach": {
    title: "Something clickable may not be reachable by keyboard",
    summary: "This element reacts to a mouse click, but the Tab key never reaches it.",
    why: "If it does something people need, such as opening a menu, keyboard users cannot use it at all.",
    who: "People who use a keyboard, switch device or screen reader",
    fix: "Use a real <button> or link for anything people click. If you must use another element, add tabindex=\"0\", a role and keyboard handling for Enter and Space.",
    impact: "serious",
    effort: "quick",
    before: '<div class="menu-toggle" onclick="openMenu()">Menu</div>',
    after: '<button type="button" class="menu-toggle" onclick="openMenu()">Menu</button>',
  },
  "legible-text-spacing": {
    title: "Text may be cut off when spacing is increased",
    summary: "With wider line, letter and word spacing, this text no longer fits its box.",
    why: "Some people with dyslexia or low vision set wider spacing to read. Fixed-height boxes then hide part of the text.",
    who: "People who change text spacing to read more easily",
    fix: "Let boxes grow with their text: avoid fixed heights on text, or use min-height instead.",
    impact: "moderate",
    effort: "quick",
    before: '<div style="height: 22px; overflow: hidden">…</div>',
    after: '<div style="min-height: 22px">…</div>',
  },
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/catalogue.test.ts tests/unit/model.test.ts`
Expected: PASS. The banned-phrasing test also covers the new entries.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rules/wcag.ts src/lib/rules/catalogue.ts tests/unit/catalogue.test.ts
git commit -m "Catalogue: plain-English entries for the agent's five checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The report model carries the agent's results

**Files:**
- Modify: `src/lib/report/model.ts`
- Test: `tests/unit/model.test.ts` (new tests appended)

**Interfaces:**
- Produces:
  - `IssueExample.shot: string | null`
  - `PageSummary.agent: { status: AgentPageResult["status"]; reason: string | null } | null`
  - `interface AgentReviewItem { pageUrl: string; kind: AgentReviewKind; title: string; selector: string; html: string; reason: string; shot: string | null }`
  - `Report.agentReviews: AgentReviewItem[]`, `Report.agentUsed: boolean`
  - `FreeSummary.agentReviewCount?: number`
  - `REVIEW_TITLE: Record<AgentReviewKind, string>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/model.test.ts`, extending its imports with `rule`, `page` and `rawScan` from `./fixture` if they are not already imported:

```ts
describe("the testing agent's results", () => {
  const withAgent = () => {
    const focus = rule("legible-focus-visible", "serious", ['<a href="#">Go</a>'], ["wcag2aa", "wcag247"]);
    focus.nodes[0].shot = "11111111-1111-4111-8111-111111111111";
    const reach = rule("legible-keyboard-reach", "serious", ['<div class="m">Menu</div>'], ["wcag2a", "wcag211"]);
    const p = page("https://www.shop.example/", [focus], ["image-alt", "legible-reflow", "legible-keyboard-trap"], {
      incomplete: [reach],
      agent: {
        status: "partly",
        reason: "time limit",
        steps: 20,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        reviews: [{ kind: "image-description", selector: "#photo", html: '<img id="photo" alt="image123">', reason: "The alt text is a file name.", shot: "22222222-2222-4222-8222-222222222222" }],
      },
    });
    return rawScan([p]);
  };

  it("counts measured failures in the score with their screenshot", () => {
    const r = buildReport(withAgent());
    const issue = r.issues.find((i) => i.ruleId === "legible-focus-visible")!;
    expect(issue.title).toBe("You cannot see where keyboard focus is");
    expect(issue.criteria.map((c) => c.sc)).toEqual(["2.4.7"]);
    expect(issue.examples[0].shot).toBe("11111111-1111-4111-8111-111111111111");
    expect(r.rulesFailed).toBe(1);
    expect(r.rulesPassed).toBe(3); // image-alt, reflow, keyboard trap
  });

  it("lists hand checks and the agent's review outside the score", () => {
    const r = buildReport(withAgent());
    expect(r.needsReview).toEqual([{ ruleId: "legible-keyboard-reach", title: "Something clickable may not be reachable by keyboard", instances: 1 }]);
    expect(r.agentReviews).toEqual([
      {
        pageUrl: "https://www.shop.example/",
        kind: "image-description",
        title: "An image description may not describe the image",
        selector: "#photo",
        html: '<img id="photo" alt="image123">',
        reason: "The alt text is a file name.",
        shot: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    expect(r.totalIssues).toBe(1);
    expect(r.agentUsed).toBe(true);
    expect(r.pages[0].agent).toEqual({ status: "partly", reason: "time limit" });
    expect(freeSummary(r).agentReviewCount).toBe(1);
  });

  it("builds old scans exactly as before", () => {
    const r = buildReport(sampleScan());
    expect(r.agentUsed).toBe(false);
    expect(r.agentReviews).toEqual([]);
    expect(r.pages.every((p) => p.agent === null)).toBe(true);
    expect(r.issues.every((i) => i.examples.every((e) => e.shot === null))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/model.test.ts`
Expected: FAIL (`shot`, `agentReviews` and `agentUsed` are undefined).

- [ ] **Step 3: Change `src/lib/report/model.ts`**

Change the type import to include the agent types:

```ts
import type { AgentPageResult, AgentReviewKind, RawNode, RawPage, RawRule, RawScan } from "@/types/scan";
```

Add `shot: string | null;` to `IssueExample`, after `embeddedFrom`. In the example builder, inside `examples.push({ … })`, add:

```ts
          shot: node.shot ?? null,
```

Add this field to `PageSummary`:

```ts
  // The testing agent's outcome on this page; null when it did not run.
  agent: { status: AgentPageResult["status"]; reason: string | null } | null;
```

Add the review type and titles above `export interface Report`:

```ts
export interface AgentReviewItem {
  pageUrl: string;
  kind: AgentReviewKind;
  title: string;
  selector: string;
  html: string;
  reason: string;
  shot: string | null;
}

export const REVIEW_TITLE: Record<AgentReviewKind, string> = {
  "image-description": "An image description may not describe the image",
  "link-purpose": "A link or button may not say where it goes",
  "heading-fit": "A heading may not describe its section",
  "error-help": "A form error may not say how to fix it",
  captions: "A video may have no captions",
};
```

Add these two fields to `Report`, after `needsReview`:

```ts
  // Judgement findings both AI passes agreed on. Never in the score.
  agentReviews: AgentReviewItem[];
  agentUsed: boolean;
```

In `buildReport`, change the `pages` mapping to:

```ts
  const pages: PageSummary[] = raw.pages.map((p) => ({
    url: p.url,
    title: p.title ?? null,
    status: p.status,
    reason: p.reason ?? null,
    issues: p.violations.reduce((sum, r) => sum + r.nodeCount, 0),
    agent: p.agent ? { status: p.agent.status, reason: p.agent.reason ?? null } : null,
  }));

  const agentReviews: AgentReviewItem[] = scanned.flatMap((p) =>
    (p.agent?.reviews ?? []).map((v) => ({
      pageUrl: p.url,
      kind: v.kind,
      title: REVIEW_TITLE[v.kind] ?? v.kind,
      selector: v.selector,
      html: v.html,
      reason: v.reason,
      shot: v.shot ?? null,
    })),
  );
```

In the returned object, add after `needsReview,`:

```ts
    agentReviews,
    agentUsed: scanned.some((p) => !!p.agent),
```

Add `agentReviewCount?: number;` to `FreeSummary`, with the comment `// Missing from summaries stored before the testing agent.`. In `freeSummary`, add `agentReviewCount: report.agentReviews.length,` after `needsReview`.

- [ ] **Step 4: Run all site unit tests and the typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. If a component uses `PageSummary` objects built by hand in a test fixture, add `agent: null` there.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/model.ts tests/unit/model.test.ts
git commit -m "Report model: agent findings, screenshots and the agent's review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Storing and serving screenshots

**Files:**
- Create: `supabase/migrations/0002_scan_shots.sql`
- Modify: `src/lib/data.ts` (`saveShots`, `getShot`)
- Modify: `src/app/api/worker/scans/[id]/route.ts` (the `shots` message)
- Create: `src/app/api/shots/[id]/route.ts`
- Test: `tests/unit/data.test.ts` (append), `tests/unit/shots-route.test.ts` (new)

**Interfaces:**
- Produces: `saveShots(scanId: string, shots: { id: string; jpeg: Buffer }[]): Promise<void>` and `getShot(id: string): Promise<Buffer | null>`. The route `GET /api/shots/[id]` returns `image/jpeg`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/data.test.ts`:

```ts
describe("screenshots", () => {
  it("stores shots against a scan, ignores repeats, and reads them back", async () => {
    const scan = await data.createScan({ url: "https://shots.example/", host: "shots.example", ipHash: "ip-shots" });
    const id = "33333333-3333-4333-8333-333333333333";
    await data.saveShots(scan.id, [{ id, jpeg: Buffer.from([0xff, 0xd8, 0xff, 0x01]) }]);
    await data.saveShots(scan.id, [{ id, jpeg: Buffer.from([0xff, 0xd8, 0xff, 0x02]) }]);
    expect((await data.getShot(id))?.equals(Buffer.from([0xff, 0xd8, 0xff, 0x01]))).toBe(true);
    expect(await data.getShot("44444444-4444-4444-8444-444444444444")).toBeNull();
  });
});
```

`tests/unit/shots-route.test.ts`:

```ts
// The worker sends screenshots before it completes a scan; anyone with a
// screenshot's id (only shown on the private result and report) can view it.
import { beforeAll, describe, expect, inject, it } from "vitest";

type Data = typeof import("@/lib/data");
let data: Data;
let workerRoute: typeof import("@/app/api/worker/scans/[id]/route");
let shotRoute: typeof import("@/app/api/shots/[id]/route");
const SECRET = "worker-secret-for-tests-0000";

beforeAll(async () => {
  process.env.DATABASE_URL = inject("databaseUrl");
  process.env.WORKER_SECRET = SECRET;
  data = await import("@/lib/data");
  workerRoute = await import("@/app/api/worker/scans/[id]/route");
  shotRoute = await import("@/app/api/shots/[id]/route");
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("screenshot routes", () => {
  it("accepts shots from the worker and serves them as JPEG", async () => {
    const scan = await data.createScan({ url: "https://r.example/", host: "r.example", ipHash: "ip-r" });
    const id = "55555555-5555-4555-8555-555555555555";
    const body = { type: "shots", shots: [{ id, data: Buffer.from([0xff, 0xd8, 0xff, 0x09]).toString("base64") }, { id: "not-a-uuid", data: "AAAA" }] };
    const res = await workerRoute.POST(
      new Request("http://x/api/worker/scans/" + scan.id, { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
      ctx(scan.id),
    );
    expect(res.status).toBe(200);
    const img = await shotRoute.GET(new Request("http://x/api/shots/" + id), ctx(id));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(img.headers.get("x-robots-tag")).toBe("noindex");
    expect(Buffer.from(await img.arrayBuffer()).equals(Buffer.from([0xff, 0xd8, 0xff, 0x09]))).toBe(true);
    expect((await shotRoute.GET(new Request("http://x/api/shots/not-a-uuid"), ctx("not-a-uuid"))).status).toBe(404);
  });

  it("refuses shots without the worker's secret", async () => {
    const scan = await data.createScan({ url: "https://s.example/", host: "s.example", ipHash: "ip-s" });
    const res = await workerRoute.POST(
      new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "shots", shots: [] }) }),
      ctx(scan.id),
    );
    expect(res.status).toBe(401);
  });
});
```

If `env.workerSecret()` reads its value once at import time, set `process.env.WORKER_SECRET` in `vitest.config.ts` `test.env` instead, with the same value.

- [ ] **Step 2: Run the tests to check they fail**

Run: `npx vitest run tests/unit/data.test.ts tests/unit/shots-route.test.ts`
Expected: FAIL (`saveShots` is not a function, and the route does not exist).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0002_scan_shots.sql`:

```sql
-- Screenshots the testing agent took of elements it reports, shown next to
-- the finding. Read only through the server connection, by unguessable id.
create table scan_shots (
  id uuid primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  image bytea not null,
  created_at timestamptz not null default now()
);
create index scan_shots_scan on scan_shots (scan_id);

alter table scan_shots enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on scan_shots from anon, authenticated';
  end if;
end
$$;
```

- [ ] **Step 4: Add the data functions to `src/lib/data.ts`**

After `failScan`:

```ts
export async function saveShots(scanId: string, shots: { id: string; jpeg: Buffer }[]): Promise<void> {
  if (!shots.length) return;
  const sql = db();
  const rows = shots.map((s) => ({ id: s.id, scan_id: scanId, image: s.jpeg }));
  await sql`insert into scan_shots ${sql(rows)} on conflict (id) do nothing`;
}

export async function getShot(id: string): Promise<Buffer | null> {
  const sql = db();
  const rows = await sql<{ image: Buffer }[]>`select image from scan_shots where id = ${id}`;
  return rows[0]?.image ?? null;
}
```

- [ ] **Step 5: Accept `shots` in `src/app/api/worker/scans/[id]/route.ts`**

Add `saveShots` to the import from `@/lib/data`. Extend `Message` with `| { type: "shots"; shots: { id: string; data: string }[] }`. Before the `progress` branch, add:

```ts
  if (msg.type === "shots") {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const list = Array.isArray(msg.shots) ? msg.shots : [];
    const shots = list
      .filter((s) => s && typeof s.id === "string" && UUID.test(s.id) && typeof s.data === "string" && s.data.length < 400_000)
      .slice(0, 200)
      .map((s) => ({ id: s.id.toLowerCase(), jpeg: Buffer.from(s.data, "base64") }))
      .filter((s) => s.jpeg[0] === 0xff && s.jpeg[1] === 0xd8); // JPEG only
    await saveShots(id, shots);
    return json({ ok: true, saved: shots.length });
  }
```

- [ ] **Step 6: Write `src/app/api/shots/[id]/route.ts`**

```ts
import { getShot } from "@/lib/data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A screenshot from a scan. Ids are random and appear only on the private
// result and report pages, like the scan and report links themselves.
export async function GET(_req: Request, ctx: RouteContext<"/api/shots/[id]">) {
  const { id } = await ctx.params;
  const image = UUID.test(id) ? await getShot(id.toLowerCase()) : null;
  if (!image) return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  return new Response(new Uint8Array(image), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=86400",
      "x-robots-tag": "noindex",
    },
  });
}
```

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS. The global setup applies `0002_scan_shots.sql` to the throwaway database.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0002_scan_shots.sql src/lib/data.ts "src/app/api/worker/scans/[id]/route.ts" "src/app/api/shots/[id]/route.ts" tests/unit/data.test.ts tests/unit/shots-route.test.ts
git commit -m "Store the agent's screenshots and serve them privately

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The report shows the agent's work

**Files:**
- Create: `src/components/report/AgentSections.tsx`
- Modify: `src/app/report/[token]/page.tsx` (use the new pieces)
- Modify: `src/app/report/[token]/report.css` (`.rp-shot`)
- Test: `tests/unit/agent-sections.test.ts`

**Interfaces:**
- Consumes: `Report`, `AgentReviewItem`, `PageSummary` from `@/lib/report/model`.
- Produces: `AgentReview({ r }: { r: Report })`, `ElementShot({ id, label }: { id: string | null; label: string })`, `agentPageNote(p: PageSummary): string | null`, `agentMethod(r: Report): string | null`.

- [ ] **Step 1: Write the failing test**

`tests/unit/agent-sections.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentReview, ElementShot, agentMethod, agentPageNote } from "@/components/report/AgentSections";
import { buildReport } from "@/lib/report/model";
import { page, rawScan } from "./fixture";

const report = (agent: boolean) =>
  buildReport(
    rawScan([
      page("https://www.shop.example/", [], ["image-alt"], agent
        ? { agent: { status: "failed", reason: "model error", steps: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, reviews: [{ kind: "link-purpose", selector: "#more", html: '<a id="more">Click here</a>', reason: "The link says only click here.", shot: "66666666-6666-4666-8666-666666666666" }] } }
        : {}),
    ]),
  );

describe("report sections for the testing agent", () => {
  it("lists the agent's review with its reasoning, code and screenshot", () => {
    const html = renderToStaticMarkup(createElement(AgentReview, { r: report(true) }));
    expect(html).toContain("The agent’s review"); // &rsquo; renders as the character itself
    expect(html).toContain("A link or button may not say where it goes");
    expect(html).toContain("The link says only click here.");
    expect(html).toContain("/api/shots/66666666-6666-4666-8666-666666666666");
    expect(html).toContain("not counted in the score");
    expect(html).not.toMatch(/compliant|legally safe/i);
  });

  it("shows nothing when the agent found nothing to review", () => {
    expect(renderToStaticMarkup(createElement(AgentReview, { r: report(false) }))).toBe("");
  });

  it("explains pages the agent could not finish, and how it worked", () => {
    const r = report(true);
    expect(agentPageNote(r.pages[0])).toBe("The testing agent could not finish this page. Its other checks are complete.");
    expect(agentMethod(r)).toContain("keyboard only");
    expect(agentMethod(report(false))).toBeNull();
  });

  it("gives each screenshot a text alternative", () => {
    const html = renderToStaticMarkup(createElement(ElementShot, { id: "66666666-6666-4666-8666-666666666666", label: "#more" }));
    expect(html).toMatch(/alt="Screenshot of the element #more"/);
    expect(renderToStaticMarkup(createElement(ElementShot, { id: null, label: "x" }))).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to check it fails**

Run: `npx vitest run tests/unit/agent-sections.test.ts`
Expected: FAIL (the module does not exist). If Vitest cannot compile the `.tsx` component, add `esbuild: { jsx: "automatic" }` at the top level of `vitest.config.ts` and run it again.

- [ ] **Step 3: Write `src/components/report/AgentSections.tsx`**

The wording here is a draft for the owner's approval (Task 16):

```tsx
// What the testing agent adds to the report. Wording awaits the owner's
// approval in the design doc.
import type { PageSummary, Report } from "@/lib/report/model";

export function ElementShot({ id, label }: { id: string | null; label: string }) {
  if (!id) return null;
  return (
    // Screenshots are served from our own route at their natural size.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="rp-shot" src={`/api/shots/${id}`} alt={`Screenshot of the element ${label}`} loading="lazy" />
  );
}

export function agentPageNote(p: PageSummary): string | null {
  if (!p.agent) return null;
  if (p.agent.status === "failed") return "The testing agent could not finish this page. Its other checks are complete.";
  if (p.agent.status === "partly") return "The testing agent reached its time limit on this page, so it tested part of it.";
  return null;
}

export function agentMethod(r: Report): string | null {
  if (!r.agentUsed) return null;
  return "On each page, Legible's testing agent also used the page with the keyboard only, at 400% zoom and with wider text spacing. Keyboard traps, focus you cannot see and sideways scrolling were measured in the browser before being reported as failures. The agent uses an AI model to judge things such as image descriptions and link wording. Those judgements are listed separately and do not change the score.";
}

export function AgentReview({ r }: { r: Report }) {
  if (!r.agentReviews.length) return null;
  return (
    <section className="rp-section rp-break" aria-labelledby="agent-review">
      <p className="rp-kicker">Worth checking</p>
      <h2 id="agent-review">The agent&rsquo;s review</h2>
      <p>
        Legible&rsquo;s testing agent used each page the way a person would and flagged these as likely problems. Each
        one was checked a second time before it was included. They are the agent&rsquo;s judgement, not measured
        failures, so they are not counted in the score. Look at each one and decide.
      </p>
      {r.agentReviews.map((v, i) => (
        <article key={`${v.pageUrl}-${v.selector}-${v.kind}`} className="rp-issue" aria-labelledby={`ar-${i}`}>
          <h3 id={`ar-${i}`}>{v.title}</h3>
          <p className="rp-where">
            <span className="rp-url">{v.pageUrl}</span> <code>{v.selector}</code>
          </p>
          <p>{v.reason}</p>
          <ElementShot id={v.shot} label={v.selector} />
          <pre>
            <code>{v.html}</code>
          </pre>
        </article>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Use the pieces in `src/app/report/[token]/page.tsx`**

- Import: `import { AgentReview, ElementShot, agentMethod, agentPageNote } from "@/components/report/AgentSections";`
- In `Pages`, after the `p.status !== "scanned"` span, add:

```tsx
                {agentPageNote(p) && <span className="rp-sub">{agentPageNote(p)}</span>}
```

- In `IssueBlock`, where each example's code is shown, add `<ElementShot id={ex.shot} label={ex.selector} />` directly after the `.rp-where` paragraph of that example.
- In `ReportPage`, render `<AgentReview r={r} />` between `<Review r={r} />` and `<Method r={r} />`.
- In `Method`, after the first paragraph, add:

```tsx
      {agentMethod(r) && <p>{agentMethod(r)}</p>}
```

- [ ] **Step 5: Style the screenshot in `report.css`**

Append:

```css
/* Screenshots of elements found by the testing agent. */
.rp-shot {
  display: block;
  max-width: min(100%, 28rem);
  height: auto;
  margin: 0.75rem 0;
  border: 1px solid var(--color-line, #d0d4dc);
  border-radius: 4px;
}
@media print {
  .rp-shot {
    max-width: 60%;
    break-inside: avoid;
  }
}
```

- [ ] **Step 6: Run the tests, typecheck, lint and the end-to-end suite**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run test:e2e`
Expected: everything PASSES. The e2e worker runs without a key, so reports look exactly as before, and the existing WCAG checks on the report page still pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/report/AgentSections.tsx "src/app/report/[token]/page.tsx" "src/app/report/[token]/report.css" tests/unit/agent-sections.test.ts vitest.config.ts
git commit -m "Report: the agent's review, screenshots and page notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Leave `vitest.config.ts` out of `git add` if Step 2 did not change it.)

---

### Task 16: Docs, wording for approval and a full check

**Files:**
- Modify: `CLAUDE.md` (Architecture: a testing-agent bullet; Commands: `--agent`)
- Modify: `scripts/setup.mjs` (a commented `# ANTHROPIC_API_KEY=` line in the `worker/.env` template, with no value)
- The owner's design doc (Claude Doc `9eaab515-4665-4a84-8f27-77e8bc0d4e33`): add the new wording for approval

- [ ] **Step 1: Update `CLAUDE.md`**

Under **Architecture**, after the Scan bullet, add:

```markdown
- **Testing agent** (`worker/src/agent/`): after axe-core, `runAgentOnPage` measures keyboard traps, focus visibility, reflow at 320px,
  text spacing and unreachable clickable elements (`measure.ts`, no AI), then Claude (`AGENT_MODEL`, default `claude-sonnet-5-5`) uses
  the page by keyboard (`actions.ts`) behind `guard.ts` (no non-GET requests, no leaving the site). Claims count only when `measure.ts`
  confirms them; judgement findings need a second, independent model pass (`review.ts`) and go to "The agent's review", never the
  score. Results reuse `RawRule` ids `legible-*`; screenshots go to `scan_shots`. Runs only when a job sends `agent: true` and
  `ANTHROPIC_API_KEY` is set; the site does not send it until the phase 2 spending cap exists. Tests use `ReplayModel`.
```

Under **Commands**, add:

```markdown
- `npm --prefix worker run scan -- https://site.com --agent` runs one scan with the testing agent (needs `ANTHROPIC_API_KEY` in `worker/.env`); screenshots go to the system temp folder.
```

- [ ] **Step 2: Add the commented key line to `scripts/setup.mjs`**

In the `worker/.env` template string, after the `WORKER_SECRET` line, add `# ANTHROPIC_API_KEY=   (paste your own key here to run the testing agent)`. Never add a value.

- [ ] **Step 3: Put the new wording in the owner's design doc**

Using the Claude Docs tools (read with `topic.index` first), add a section, "Testing agent wording (awaiting approval)", to doc `9eaab515-4665-4a84-8f27-77e8bc0d4e33`. It lists every new customer-facing string, copied exactly from `src/components/report/AgentSections.tsx`, the five catalogue entries from Task 12 and `REVIEW_TITLE` from Task 13. Mark each with "Approve / change".

- [ ] **Step 4: Run every check**

Run, in turn:

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npx vitest run
```

```bash
npm --prefix worker test
```

```bash
npm run test:e2e
```

Expected: all PASS. Record the counts (unit, worker and e2e) for the report to the owner.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md scripts/setup.mjs
git commit -m "Docs: the testing agent, how to run it, where the key goes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: First real runs (only after the owner has added their key)

This task needs the owner's `ANTHROPIC_API_KEY` in `worker/.env`. Claude never types it. If the key is not there, stop and ask the owner. Every run here costs real money (about $0.10 to $0.30 per page by estimate), so get the owner's go-ahead before starting.

- [ ] **Step 1: Check the key is set without printing it**

Run: `grep -c '^ANTHROPIC_API_KEY=.\+' worker/.env`
Expected: `1`.

- [ ] **Step 2: Run the agent on the fixture site, then two real sites**

Start the fixture site in one terminal:

```bash
node tests/fixtures/serve.mjs 5055
```

Then scan the fixture's focus page with the agent:

```bash
ALLOW_PRIVATE_TARGETS=1 npm --prefix worker run scan -- http://127.0.0.1:5055/agent/focus.html --agent
```

Then scan gov.uk, which is known to be good:

```bash
npm --prefix worker run scan -- https://www.gov.uk --agent
```

Then the W3C "bad" demo, which is known to be bad:

```bash
npm --prefix worker run scan -- https://www.w3.org/WAI/demos/bad/before/home.html --agent
```

Expected:
- the fixture has `legible-focus-visible` on `#bad` only;
- gov.uk has no `legible-*` failures;
- the W3C demo has failures and some agent reviews;
- every page's `agent.status` is `tested` or `partly`.

- [ ] **Step 3: Check every finding by hand**

Open each screenshot in the printed `shots` folder and each `legible-*` selector on the live page. Any finding that is wrong is a bug: write a failing test for it, fix it, and repeat Step 2.

- [ ] **Step 4: Work out the real cost per page**

From each run's `agent.usage`, at Claude Sonnet 5.5 prices (input $2, output $10, cache reads $0.20 and cache writes $2.50 per million tokens):

`cost = (input × 2 + output × 10 + cacheRead × 0.2 + cacheWrite × 2.5) / 1,000,000`

Divide by the number of pages and report the per-page and per-scan figures to the owner.
