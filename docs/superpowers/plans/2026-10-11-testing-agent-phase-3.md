# Testing agent phase 3: a tested fix for every problem, and a fix plan. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every failure group gets a fix that was tested in the browser (rule-based first, then AI-written, else guidance only), every scan gets a deterministic fix order plan, and the free result shows all of it.

**Architecture:** The worker tests fixes on the page it has open, after axe-core and the agent: it applies each fix (changed attributes, an added stylesheet rule, or a replaced element), re-runs the same check on that one element, then undoes the change. Rule-based fixes come from `fixes.ts`, which the worker now carries as a byte-identical copy. When the agent is on, the model writes fixes for groups with no working rule-based fix (40 per scan, one retry). Results ride on each `RawNode` as `fix`. The site's pure `buildReport` reads them, and a new pure `buildFixPlan` orders the work. The free result page builds the report from `scans.raw` and shows the plan and every problem with its fix.

**Tech Stack:** Next.js 16, Playwright + axe-core in the worker, Anthropic SDK via the existing `AgentModel`, Vitest (site and worker), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-09-testing-agent-design.md`, section 11 (and 8.10).

## Global Constraints

- Fix contract on `RawNode`: `fix?: { code: string; kind: "html" | "css" | "note"; status: "tested" | "untested"; source: "rule" | "ai"; note?: string } | null`. `null` means fixes were tried and none passed: guidance only. Missing means not tried. Older scans without it build exactly as today.
- Order of fixes: rule-based, then AI-written, then guidance only. A fix that fails its test is never shown.
- A fix that cannot be tried on a copy of the page (script, server or CMS change) is shown as "Not tested. Check it with your developer", never as certain.
- At most 40 AI-written fixes per free scan (`AI_FIXES_PER_SCAN`). AI fixes use the metered agent model, so they count toward the daily cap. A capped scan gets rule-based fixes only.
- Builder detection: WordPress, Shopify, Wix, Squarespace, Webflow. The fix note names the tool; no click-by-click steps.
- Fix plan: fixed rules, not AI. Critical, serious, moderate, minor; within a level, quick, moderate, involved. Time per problem group: quick 10 minutes, moderate 1 to 2 hours, involved half a day (3 to 4 hours). Total shown as a range. Who: catalogue `doer: "you" | "developer"`.
- Every catalogue entry has a `doer`, enforced by the catalogue test.
- `src/types/scan.ts` and `worker/src/types.ts` stay identical from `export interface RawNode` on. `src/lib/rules/fixes.ts` + `contrast.ts` and `worker/src/rules/` copies stay byte-identical (test).
- Worker `page.evaluate` takes strings only.
- New customer-facing wording goes into the owner's design doc as awaiting approval. British spelling, short sentences, no em-dash chains, no "not X, but Y". Never "compliant" or "legally safe".
- Do not touch `.gitignore`, `eslint.config.mjs`, `tsconfig.json`, `.design-sync/`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A rule-based fix that passes axe on the element but breaks the page (for example a replaced element that loses its children): the tester must undo every change, so later checks on the same page see the original page.
2. Elements inside frames, or whose selector no longer matches after the agent changed the page: no fix is applied and nothing is claimed as tested.
3. A model answer that is not a single element for an "html" fix, or is very long: refused, never applied.
4. The time budgets: fix testing must never push a page past its timeout, so the page keeps its axe-core and agent results.
5. Old scans (no `fixVersion`): the report and free result look as before, apart from the new plan and the free result showing every problem.

---

### Task 1: Who can do each fix

**Files:** Modify `src/lib/rules/catalogue.ts`, `tests/unit/catalogue.test.ts`.

**Interfaces:** Produces `export type Doer = "you" | "developer"` and `RuleInfo.doer: Doer`.

- [ ] **Step 1: Failing test** (append to `tests/unit/catalogue.test.ts`):

```ts
describe("who can do each fix", () => {
  it("names a doer for every entry, and the owner for content fixes", () => {
    for (const [id, info] of Object.entries(CATALOGUE)) expect(["you", "developer"], id).toContain(info.doer);
    const you = Object.entries(CATALOGUE).filter(([, i]) => i.doer === "you").map(([id]) => id).sort();
    expect(you).toEqual(["audio-caption", "document-title", "image-alt", "link-name", "p-as-heading", "table-fake-caption", "video-caption"]);
  });
});
```

(Import `CATALOGUE` if the file does not already.)

- [ ] **Step 2: Run** `npx vitest run tests/unit/catalogue.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Add `export type Doer = "you" | "developer";`, `doer: Doer;` to `RuleInfo` with the header comment line `//   doer     "you": an owner can do it in their website builder (alt text, link wording, headings, captions); "developer": it needs code`. Insert `doer: "you",` after the `effort:` line of the seven entries above and `doer: "developer",` after every other entry's `effort:` line (a script over the file, then read the diff).
- [ ] **Step 4: Run** the catalogue test and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `Catalogue: say who can do each fix`.

### Task 2: The fix contract

**Files:** Modify `src/types/scan.ts`, `worker/src/types.ts`, `tests/unit/contract.test.ts`.

**Interfaces:** Produces `FixKind`, `NodeFix`, `RawNode.fix?: NodeFix | null`, `RawScan.builtWith?: string`, `RawScan.fixVersion?: 1`.

- [ ] **Step 1: Failing test** (add to the contract test):

```ts
  it("carries tested fixes and the site's builder", () => {
    const text = part("src/types/scan.ts");
    for (const name of ["export interface NodeFix", "fix?: NodeFix | null", "builtWith?: string", "fixVersion?: 1"]) {
      expect(text).toContain(name);
    }
  });
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/contract.test.ts` → FAIL.
- [ ] **Step 3: Implement** in both files (identical text). In `RawNode`, after `shot?`:

```ts
  // A fix for this element. Missing: no fix was tried (older scans, or past
  // the worker's limits). null: fixes were tried and none passed its test, so
  // the report gives guidance only.
  fix?: NodeFix | null;
```

In `RawScan`, after `agent?`:

```ts
  // The website builder the home page was made with, when recognised.
  builtWith?: string;
  // Set by workers that test fixes: a node without `fix` was not tried.
  fixVersion?: 1;
```

After `AgentPageResult`:

```ts
export type FixKind = "html" | "css" | "note";

// A fix the worker tried in the browser. "tested": the same check passed on
// the page with the fix applied. "untested": it could not be tried there,
// such as a change to a script or the server.
export interface NodeFix {
  code: string;
  kind: FixKind;
  status: "tested" | "untested";
  source: "rule" | "ai";
  note?: string;
}
```

- [ ] **Step 4: Run** contract test and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `Contract: tested fixes on each element, and the site's builder`.

### Task 3: One copy of the rule-based fixes for the worker

**Files:** Modify `src/lib/rules/fixes.ts` (add `fixKind`); create `worker/src/rules/fixes.ts`, `worker/src/rules/contrast.ts` (copies); test `tests/unit/contract.test.ts`, `tests/unit/fixes.test.ts`.

**Interfaces:** Produces `fixKind(code: string): FixKind` in both copies; worker imports `suggestFix`, `completeSnippet`, `fixKind` from `./rules/fixes`.

- [ ] **Step 1: Failing tests.** In `tests/unit/fixes.test.ts`:

```ts
describe("fixKind", () => {
  it("tells markup, stylesheet rules and notes apart", () => {
    expect(fixKind('<img src="a.jpg" alt="[Describe the image]">')).toBe("html");
    expect(fixKind("#main > p {\n  color: #595959; /* was #999999 */\n}")).toBe("css");
    expect(fixKind("<!-- Remove this tag. -->")).toBe("note");
  });
});
```

In the contract test:

```ts
  it("gives the worker the same rule-based fixes as the site", () => {
    for (const f of ["fixes.ts", "contrast.ts"]) {
      expect(readFileSync(`worker/src/rules/${f}`, "utf8"), f).toBe(readFileSync(`src/lib/rules/${f}`, "utf8"));
    }
  });
```

- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement** in `src/lib/rules/fixes.ts`, after `SuggestedFix`:

```ts
// How a fix is applied: markup (changed or added elements), a stylesheet
// rule, or a note that says what to change (an HTML comment).
export function fixKind(code: string): "html" | "css" | "note" {
  const t = code.trim();
  if (t.startsWith("<!--")) return "note";
  if (t.startsWith("<")) return "html";
  return /\{[\s\S]*\}/.test(t) ? "css" : "note";
}
```

Then `mkdir -p worker/src/rules && cp src/lib/rules/fixes.ts src/lib/rules/contrast.ts worker/src/rules/`. Both files import only each other, so the copies compile in the worker.

- [ ] **Step 4: Run** both tests and `npm run typecheck` (checks the worker too) → PASS.
- [ ] **Step 5: Commit** `Fixes: the worker carries the same rule-based fixes as the site`.

### Task 4: Recognise the website builder

**Files:** Create `worker/src/builder.ts`; modify `worker/src/scan.ts` (home page only); test `worker/test/builder.test.ts`.

**Interfaces:** Produces `BUILDER_PROBE: string` (page script returning `string | null`) and `RawScan.builtWith` set from the home page.

- [ ] **Step 1: Failing test** `worker/test/builder.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { BUILDER_PROBE } from "../src/builder";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => browser.close());

const probe = async (html: string) => {
  const page = await browser.newPage();
  await page.setContent(html);
  const out = await page.evaluate(BUILDER_PROBE);
  await page.close();
  return out;
};

it("recognises the common website builders from the page's code", async () => {
  expect(await probe('<meta name="generator" content="WordPress 6.6"><p>x</p>')).toBe("WordPress");
  expect(await probe('<link rel="stylesheet" href="https://example.com/wp-content/themes/a/style.css">')).toBe("WordPress");
  expect(await probe('<script src="https://cdn.shopify.com/s/files/x.js"></script>')).toBe("Shopify");
  expect(await probe('<meta name="generator" content="Wix.com Website Builder">')).toBe("Wix");
  expect(await probe('<link rel="stylesheet" href="https://static1.squarespace.com/static/x.css">')).toBe("Squarespace");
  expect(await probe('<html data-wf-site="abc"><body>x</body></html>')).toBe("Webflow");
  expect(await probe("<p>Hand-made</p>")).toBeNull();
});
```

- [ ] **Step 2: Run** `npm --prefix worker test -- builder` → FAIL.
- [ ] **Step 3: Implement** `worker/src/builder.ts`:

```ts
// Recognises the website builder a page was made with, from its own code, so
// the report can say where a fix is made. A string: see the note in dom.ts.
export const BUILDER_PROBE = `(function () {
  var gen = (document.querySelector('meta[name="generator" i]') || {}).content || '';
  var urls = Array.prototype.map.call(document.querySelectorAll('script[src], link[href]'), function (e) { return e.src || e.href; }).join(' ');
  if (/wordpress/i.test(gen) || /\\/wp-(content|includes)\\//.test(urls)) return 'WordPress';
  if (/shopify/i.test(gen) || /cdn\\.shopify\\.com/.test(urls) || window.Shopify) return 'Shopify';
  if (/wix\\.com/i.test(gen) || /static\\.wixstatic\\.com|static\\.parastorage\\.com/.test(urls)) return 'Wix';
  if (/squarespace/i.test(gen) || /squarespace(-cdn)?\\.com/.test(urls)) return 'Squarespace';
  if (/webflow/i.test(gen) || document.documentElement.hasAttribute('data-wf-site')) return 'Webflow';
  return null;
})()`;
```

In `scanPage`, when `first` is true, after `collectLinks`: `const builtWith = first ? ((await page.evaluate(BUILDER_PROBE).catch(() => null)) as string | null) : null;` and return it with the page result. In `scanSite`, keep the home page's value and set `raw.builtWith = builtWith` when it is a string. Set `raw.fixVersion = 1` there too (Task 8 is when nodes start carrying fixes; the flag goes in with this task's commit only after Task 8 lands, so add it in Task 8, not here).

- [ ] **Step 4: Run** `npm --prefix worker test -- builder scan` → PASS.
- [ ] **Step 5: Commit** `Worker: recognise the website builder on the home page`.

### Task 5: Apply a fix to one element, check again, undo

**Files:** Create `worker/src/fixes/apply.ts`; fixtures `tests/fixtures/site/fixes/{alt,contrast,label,viewport}.html`; test `worker/test/fix-apply.test.ts`; add the fixture names to `worker/test/fixtures.test.ts`.

**Interfaces:**
- Produces `type Verdict = "pass" | "fail" | "unknown" | "untestable"` and
  `tryFix(page: Page, input: { ruleId: string; selector: string; html: string; fix: { code: string; kind: FixKind }; replace?: boolean }): Promise<Verdict>`.
  - `kind: "css"`: adds `<style data-legible-fix>` with the code.
  - `kind: "html"`, `replace` false (rule-based): when the fixed code is one element with the same tag as `html`, applies the attribute differences between `html` and the fix to the live element; when it is `<label for="…">…</label>` followed by the original, inserts that label before the element; otherwise `"untestable"`.
  - `kind: "html"`, `replace` true (AI): replaces the element with the fix, which must parse to exactly one element of at most 6,000 characters, else `"untestable"`.
  - `kind: "note"`: `"untestable"`.
  - Then re-checks: axe-core rules with `AxeBuilder.include("[data-legible-fix-el]")` and `runOnly` the one rule (violation → fail, incomplete → unknown, neither → pass). `legible-focus-visible` with `measureFocusAt`, `legible-keyboard-trap` with `trapFrom` (both measured before the fix too: no baseline failure → unknown). `legible-reflow`, `legible-text-spacing`, `legible-keyboard-reach` by re-measuring the page and checking whether any finding is, contains or is inside the marked element.
  - Always undoes the change (restores attributes, removes the label or style, puts the original element back) and removes the marker, in a `finally`.
  - Elements whose selector does not match exactly one element: `"untestable"`.

Fixture pages (all valid HTML with `<html lang="en">`, a `<title>` and one `<main>`):
- `fixes/alt.html`: `<img id="pic" src="/smile.png">`.
- `fixes/contrast.html`: `<p id="soft" style="color:#aaaaaa">Soft grey text</p>` and `<style>#stub{color:#bbbbbb !important}</style><p id="stub">Stubborn grey text</p>` on white.
- `fixes/label.html`: `<input id="email" type="text">` with no label.
- `fixes/viewport.html`: `<meta name="viewport" content="width=device-width, maximum-scale=1">`.

- [ ] **Step 1: Failing tests** `worker/test/fix-apply.test.ts` (serve the fixture site on port 5081 with `serveFixture`, one shared Chromium page per test):

```ts
it("passes a rule-based attribute fix and leaves the page as it was", async () => {
  await page.goto(`${base}/fixes/alt.html`);
  const v = await tryFix(page, { ruleId: "image-alt", selector: "#pic", html: '<img id="pic" src="/smile.png">', fix: { code: '<img id="pic" src="/smile.png" alt="[Describe the image]">', kind: "html" } });
  expect(v).toBe("pass");
  expect(await page.evaluate(`document.querySelector('#pic').hasAttribute('alt')`)).toBe(false);
  expect(await page.evaluate(`document.querySelectorAll('[data-legible-fix-el], [data-legible-fix]').length`)).toBe(0);
});

it("passes an inline colour fix and fails a stylesheet rule that loses to !important", async () => {
  await page.goto(`${base}/fixes/contrast.html`);
  expect(await tryFix(page, { ruleId: "color-contrast", selector: "#soft", html: '<p id="soft" style="color:#aaaaaa">', fix: { code: '<p id="soft" style="color:#595959">', kind: "html" } })).toBe("pass");
  expect(await tryFix(page, { ruleId: "color-contrast", selector: "#stub", html: '<p id="stub">', fix: { code: "#stub {\n  color: #595959;\n}", kind: "css" } })).toBe("fail");
  expect(await page.evaluate(`document.querySelectorAll('style[data-legible-fix]').length`)).toBe(0);
});

it("tests a label added before the field", async () => {
  await page.goto(`${base}/fixes/label.html`);
  const v = await tryFix(page, { ruleId: "label", selector: "#email", html: '<input id="email" type="text">', fix: { code: '<label for="email">[Field name]</label>\n<input id="email" type="text">', kind: "html" } });
  expect(v).toBe("pass");
  expect(await page.evaluate(`document.querySelectorAll('label').length`)).toBe(0);
});

it("tests a viewport fix on the meta tag", async () => {
  await page.goto(`${base}/fixes/viewport.html`);
  const v = await tryFix(page, { ruleId: "meta-viewport", selector: 'meta[name="viewport"]', html: '<meta name="viewport" content="width=device-width, maximum-scale=1">', fix: { code: '<meta name="viewport" content="width=device-width">', kind: "html" } });
  expect(v).toBe("pass");
});

it("replaces an element for an AI fix, and refuses markup that is not one element", async () => {
  await page.goto(`${base}/agent/focus.html`);
  expect(await tryFix(page, { ruleId: "legible-focus-visible", selector: "#bad", html: "", fix: { code: "#bad:focus-visible { outline: 3px solid #000; outline-offset: 2px; }", kind: "css" } })).toBe("pass");
  expect(await tryFix(page, { ruleId: "image-alt", selector: "#bad", html: "", fix: { code: "<b>a</b><b>b</b>", kind: "html" }, replace: true })).toBe("untestable");
  expect(await tryFix(page, { ruleId: "image-alt", selector: "#nothing-here", html: "", fix: { code: "a{}", kind: "css" } })).toBe("untestable");
  expect(await tryFix(page, { ruleId: "image-alt", selector: "#bad", html: "", fix: { code: "Change the menu script.", kind: "note" } })).toBe("untestable");
});
```

(Read `tests/fixtures/site/agent/focus.html` first and use its real ids for `#bad`.)

- [ ] **Step 2: Run** `npm --prefix worker test -- fix-apply` → FAIL (module missing).
- [ ] **Step 3: Implement** `worker/src/fixes/apply.ts` as specified in Interfaces. Page scripts are strings built with `JSON.stringify` for every value. Attribute differences are worked out in the page with a `<template>`: parse the original snippet and the fix, compare their first elements' attribute lists, and apply only what differs (set or remove), remembering the live values to restore. Re-checks for axe rules use `new AxeBuilder({ page }).include("[data-legible-fix-el]").options({ runOnly: { type: "rule", values: [ruleId] }, resultTypes: ["violations", "incomplete"] }).analyze()`; an exception is `"unknown"`. The page-level measurements return selectors; check containment in the page against the marked element.
- [ ] **Step 4: Run** `npm --prefix worker test -- fix-apply fixtures` → PASS.
- [ ] **Step 5: Commit** `Worker: try a fix on one element, check it again, and undo it`.

### Task 6: Test the rule-based fixes on each page

**Files:** Create `worker/src/fixes/rules.ts`; test `worker/test/fix-rules.test.ts`.

**Interfaces:**
- Consumes `tryFix`, `suggestFix`, `completeSnippet`, `fixKind`.
- Produces `FIX_NODES_PER_RULE = 5` and `testRuleFixes(page: Page, violations: RawRule[], deadline: number): Promise<RawNode[]>`, which sets `node.fix` on the nodes it could decide and returns the nodes whose rule-based fix failed its test (left without `fix`, for the AI step).
  - Skips `legible-*` rules (no rule-based fixes), nodes inside frames (`target.length !== 1`) and nodes past `FIX_NODES_PER_RULE` per rule.
  - `suggestFix` returns null: node left alone.
  - `fixKind` is "note": `{ code, kind: "note", status: "untested", source: "rule" }`.
  - Verdict pass: `status: "tested"`; unknown or untestable: `"untested"`; fail: returned.
  - Stops when `Date.now() > deadline`.

- [ ] **Step 1: Failing test** on `fixes/contrast.html` and `fixes/alt.html`: run axe on the page as `scan.ts` does (use `scanSite` on the single page with `pauseMs: 10` is too much; call `new AxeBuilder({ page }).options({ runOnly: { type: "rule", values: ["image-alt", "color-contrast"] } }).analyze()` and map with the same shape as `toRawPage`, or export `toRawPage` from scan.ts and use it). Expect `#pic` → tested; `#soft` → tested; `#stub` → returned as failed with no `fix`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Worker: test the rule-based fix for each failing element`.

### Task 7: The model writes a fix when there is no working one

**Files:** Create `worker/src/fixes/ai.ts`; test `worker/test/fix-ai.test.ts`.

**Interfaces:**
- Consumes `AgentModel`, `tryFix`.
- Produces `AI_FIXES_PER_SCAN = 40`, `FIX_PROMPT`, `FIX_TOOL` (strict tool `fix`: `kind` enum html/css/note, `code` string, `note` string), and
  `writeFix(model: AgentModel, page: Page, failure: { ruleId: string; help: string; summary: string; selector: string }, deadline: number): Promise<NodeFix | null>`.
  - Reads the element's context in the page: `outerHTML` (first 4,000 characters) and the computed values of `color, background-color, font-size, font-weight, display, position, outline, outline-offset, width, max-width, height, overflow, white-space`.
  - Turn 1 asks for one fix. Answer kind "note": returns `{ …, status: "untested", source: "ai" }` without testing. Kind "html" or "css": `tryFix` with `replace: true`. Pass → tested; unknown or untestable → untested; fail → turn 2 with the tool result "That fix was applied and the same check still fails. Try a different fix." Fail again → null. No tool call, an error or the deadline → null.
  - `code` over 6,000 characters → treated as no answer.

- [ ] **Step 1: Failing tests** with `ReplayModel` on `agent/focus.html`: (a) a CSS answer that adds a visible outline → tested, `source: "ai"`; (b) first answer a CSS rule that changes nothing (`#bad { color: inherit; }`), second a working outline → tested after two turns, `model.requests.length === 2`; (c) two answers that change nothing → null; (d) a note answer → untested without any test; (e) text with no tool call → null.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`FIX_PROMPT`: "You fix one accessibility failure on a web page. You get the failing element's code, its computed styles and the failure. Answer with the fix tool only. Prefer the smallest change. Use kind css for a stylesheet rule that targets the element's selector, html for the element rewritten in full (one element), and note when the change has to be made in a script, on the server or in a content management system. Never invent content: put text only the owner can write in [square brackets]. Keep note to one or two short sentences in plain English for a small business owner, in British spelling."). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Worker: the model writes a fix where no rule-based fix works, tested before it is kept`.

### Task 8: Fix testing in every scan

**Files:** Modify `worker/src/scan.ts`; test `worker/test/scan-fixes.test.ts`.

**Interfaces:**
- `ScanOptions.fixBudget?: { left: number }` (scanSite creates `{ left: AI_FIXES_PER_SCAN }` when `agent` is set).
- Constants `RULE_FIX_MS = 20_000`, `AI_FIX_MS = 90_000`; page timeout grows by `RULE_FIX_MS + (agent ? AI_FIX_MS : 0)`.
- On each kept page, after the agent: `testRuleFixes` with its deadline. Then, with an agent and budget left, one AI fix per failure group (one rule on this page) that has no node with a `fix`: the group's first own-page node (failed rule fix first). Each attempt takes one from the budget. A node whose rule fix failed and got no AI fix gets `fix: null`; so does the chosen node of a group whose AI fix came back null.
- The whole fix step is inside a try/catch: an error leaves the page's results as they are.
- `raw.fixVersion = 1` on every scan.

- [ ] **Step 1: Failing tests:** (a) `scanSite` on `fixes/alt.html` without an agent → the image-alt node has `fix.status === "tested"`, `raw.fixVersion === 1`; (b) with a `ReplayModel` whose answers are the agent's `done` steps followed by an outline CSS fix, on `agent/focus.html` → the `legible-focus-visible` node has `fix.source === "ai"`; (c) with `fixBudget` exhausted (`{ left: 0 }` passed in) → no AI fix and no extra model requests.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm --prefix worker test` (whole suite) → PASS.
- [ ] **Step 5: Commit** `Worker: every scan tests its fixes; the agent writes the missing ones`.

### Task 9: The report reads the tested fixes

**Files:** Modify `src/lib/report/model.ts`; test `tests/unit/model.test.ts`.

**Interfaces:**
- `IssueExample` gains `fixStatus: "tested" | "untested" | null`, `fixSource: "rule" | "ai" | null`, `fixKind: FixKind | null`, `guidanceOnly: boolean`.
- `Issue` gains `doer: Doer`.
- `Report` gains `builtWith: string | null`.
- Per example: embedded → as today. `node.fix === null` → `fixed: null`, `guidanceOnly: true`. `node.fix` → `fixed: fix.code`, status/source/kind from it, `note: fix.note ?? (source === "rule" ? suggestFix(...)?.note : null) ?? null`. No `fix`: `suggestFix` as today, with `fixStatus: raw.fixVersion ? "untested" : null`.

- [ ] **Step 1: Failing tests:** an old scan builds the same examples as before plus `fixStatus: null`; a node with a tested AI css fix gives `fixed`, `fixStatus: "tested"`, `fixSource: "ai"`, `fixKind: "css"`; `fix: null` gives `guidanceOnly: true` and no `fixed`; a `fixVersion: 1` scan with an untried node gives `fixStatus: "untested"`; `builtWith` passes through; `doer` comes from the catalogue.
- [ ] **Step 2–4:** Run → FAIL, implement, run → PASS. **Step 5: Commit** `Report: read the tested fixes, who can do them and the site's builder`.

### Task 10: The fix order plan

**Files:** Create `src/lib/report/plan.ts`; modify `src/lib/report/model.ts` (`Report.plan`); test `tests/unit/plan.test.ts`.

**Interfaces:**

```ts
export const EFFORT_MINUTES: Record<Effort, [number, number]> = { quick: [10, 10], moderate: [60, 120], involved: [180, 240] };
export interface PlanStep { n: number; ruleId: string; title: string; places: number; impact: Impact; effort: Effort; doer: Doer; minutes: [number, number] }
export interface FixPlan { steps: PlanStep[]; minutes: [number, number]; you: number; developer: number; embedded: number }
export function buildFixPlan(issues: Issue[]): FixPlan;
export function planTime(minutes: [number, number]): string; // "about 10 minutes", "about 1 to 2 hours", "about 3 hours"
export function planIntro(plan: FixPlan): string;
export function stepLine(step: PlanStep): string;
```

- Order: impact (critical first), then effort (quick, moderate, involved), then places (most first), then title. Issues wholly from embedded content are left out and counted in `embedded`.
- `planTime`: under 60 minutes at the top → "about N minutes"; else hours rounded to the nearest whole hour (at least 1), "about L to H hours", or "about N hour(s)" when equal.
- `planIntro`: "{steps} steps, {time} in total. {you} you can do yourself, {developer} need a developer." (singulars: "1 step", "1 you can do yourself", "1 needs a developer"; a zero part is left out.)
- `stepLine`: "{places} {place|places}, {time}. {You can do this yourself.|Needs a developer.}"

- [ ] **Step 1: Failing tests:** order across impacts and efforts; ties by places then title; embedded left out and counted; totals and the you/developer split; `planTime` cases (10→10, 70→130, 180→240, 30→30 equal); `planIntro` singular and plural; the same issues in any order give the same plan.
- [ ] **Step 2–4.** **Step 5: Commit** `Report: a fix order plan worked out by fixed rules`.

### Task 11: Show the plan, the fixes and their status

**Files:** Create `src/components/results/FixPlan.tsx`, `src/components/report/FixLabels.tsx` (shared text helpers + small components); modify `src/components/results/IssueDetail.tsx`, `src/app/report/[token]/page.tsx`, `src/app/scan/[id]/page.tsx`, `src/app/report/report.css` (if it exists there; else wherever `rp-` styles live); test `tests/unit/fix-display.test.ts`.

**Interfaces:**
- `fixLabel(ex: IssueExample): string | null`: tested → "Tested fix"; untested → "Not tested. Check it with your developer"; otherwise null.
- `codeLabel(kind: FixKind | null): string`: css → "Add this CSS"; note → "Suggested change"; else "Corrected".
- `GUIDANCE_ONLY = "None of the fixes we tried passed our test for this element. Follow How to fix it above."`
- `builderNote(name: string): string` = "Your site looks like it is built with {name}. Make these changes in {name} or in your theme, or ask whoever looks after the site."
- Result page (`/scan/[id]`, not clean): loads `getScanRaw`, `buildReport(raw)`; shows, in order: the score header, counts, `AgentCapNote`, the plan (`FixPlan`, heading "Your fix plan", the builder note when set, numbered steps linking to `#issue-{ruleId}`), "Worth checking" (the agent's review titles, reasons and selectors, when any), "Every problem, with its fix" (an `IssueDetail` per issue, each with `id="issue-{ruleId}"`), then the offer box and the rest as now. The `Locked` placeholder and the "Two of your issues" section go.
- Report page: a "Your fix plan" section after the summary, the same content in `rp-` styles; each example's code label from `codeLabel`, the fix label beside it, `GUIDANCE_ONLY` in place of the general example when `guidanceOnly`.

- [ ] **Step 1: Failing tests** (renderToStaticMarkup): `FixPlan` lists steps in order with links to `#issue-…` and the intro line; `IssueDetail` shows "Tested fix" for a tested example and "Not tested. Check it with your developer" for an untested one, and `GUIDANCE_ONLY` with no general example when `guidanceOnly`; `fixLabel`/`codeLabel` cases.
- [ ] **Step 2–4.** Then check both pages in the browser preview at 1280 and 375 pixels wide.
- [ ] **Step 5: Commit** `Result and report: the fix plan first, then every problem with its tested fix`.

### Task 12: Wording, docs and the full check

**Files:** `src/app/page.tsx` (chapter 7), `src/app/scan/[id]/page.tsx` (offer box), `src/lib/email/wording.ts` and `src/app/dev/emails/page.tsx` (next step), `tests/e2e/journey.spec.ts`, `tests/e2e/clean.spec.ts`, `CLAUDE.md`, the owner's design doc.

Proposed wording (to the design doc as awaiting approval):
- Landing chapter 7, first line: "You landed. The free scan tests your home page and up to five more pages, and gives you a tested fix for every problem it finds, in the order to do them."
- Landing chapter 7, second line: "The full report tests your whole site, up to 50 pages, and comes as a PDF you can share, for a one-time {price}."
- Offer box heading: "Test your whole site". Bullets: "Every page of your site, up to 50, tested the same way"; "A fix for every problem, and one plan for the whole site"; "A PDF and a link you can share, dated for your records"; "Sorted into must fix, should fix and nice to have". Button: "Test the whole site · {price}".
- Email next step: "Your free result has a fix for every problem we found. The full report tests your whole site, up to 50 pages, and comes as a PDF you can share. It costs {price}, once."
- Plan, labels and notes: the strings in Tasks 10 and 11.

Note for the owner, in the doc and the final message: the offer wording describes phase 4 (whole site). Phase 3 must not go live on its own, or the $99 report would promise pages it does not yet test.

- [ ] **Step 1:** Update the e2e tests first to the new headings and button ("Your fix plan", "Every problem, with its fix", "Test the whole site · $99"); run `npm run test:e2e` → FAIL on the old page.
- [ ] **Step 2:** Change the wording in the files above.
- [ ] **Step 3:** Design doc rows; `CLAUDE.md` architecture bullet for fixes (`worker/src/fixes/`, `worker/src/rules/` copies, `src/lib/report/plan.ts`).
- [ ] **Step 4:** `npm run lint`, `npm run typecheck`, `npm test`, `npm --prefix worker test`, `npm run test:e2e` → all pass.
- [ ] **Step 5: Commit** `Wording: the free result gives every fix; the $99 report tests the whole site`.
