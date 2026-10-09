# Legible testing agent: design

Date: 9 October 2026. Status: written for the owner's review. No code until approved.

## 1. What the owner asked for

"Make an agent in the website to check everything on the website", tested clearly, with no mistakes.

Decisions the owner made while we designed this (9 October):

| Question | Decision |
|---|---|
| What the agent adds | Tests like a person, checks more pages, shows its work live, explains problems |
| How it decides | An AI agent (approach B), not only scripted tests |
| Unsure results | Proven results are failures. Unsure ones go to "Check by hand" and never lower the score |
| Judgement findings (image descriptions, link wording and so on) | A separate section, "The agent's review", checked twice by the AI, not in the score |
| Pages | Free scan: home page plus 5, agent on all of them. Paid report: whole site, up to 50 pages |
| Cost control | Free scans and free chat share a daily cap of $10. Paid work is outside the cap, with a hard stop of $15 per report |
| Chat | Anyone can watch and ask 5 questions per free scan. Paying customers can ask 100 per report |
| API key | The owner creates an Anthropic API key and pastes it into the settings. Claude never types it |

What stays the same: the existing automatic checks (axe-core), the free result, the $99 report and PDF, the legal phrasing rules, and the rule that only the site touches the database.

## 2. Build order

The work is four phases. Each one is designed here, built, tested and committed before the next one starts, and each leaves the site working.

1. **Agent core.** The worker's agent tests each page of a free scan. Its results reach the score, the free result and the report. No new screens yet.
2. **Spending ledger and daily cap.** The cost of every agent run is recorded, the $10 daily cap is enforced, and the agent falls back cleanly when the cap is reached.
3. **Whole-site paid testing.** After payment, the agent tests up to 50 pages and the report fills in as it goes.
4. **Live view and chat.** These are the only new screens. A mockup goes into the owner's design doc for approval first.

Phase 1 needs no API key to build or test (see 8). The first real run needs the owner's key. The agent is not switched on for real visitors until phase 2's cap is in place.

## 3. The agent (phase 1)

### 3.1 Where it runs

In the scan worker, on each page, after the existing axe-core checks and before the page closes. New folder `worker/src/agent/`:

| File | One job |
|---|---|
| `model.ts` | The `AgentModel` interface (`step(messages) -> { actions, usage }`), with two implementations: `AnthropicModel` (Claude through `@anthropic-ai/sdk`) and `ReplayModel` (recorded answers, for tests) |
| `actions.ts` | The only actions the agent may take, each validated before it runs |
| `guard.ts` | Blocks anything that could change the customer's site (see 3.3) |
| `measure.ts` | The measurements that confirm or reject the agent's claims (see 3.4) |
| `review.ts` | The second, independent AI pass over judgement findings (see 3.5) |
| `run.ts` | `runAgentOnPage(page, options) -> AgentPageResult`: the step loop, limits and result |

Model: `claude-sonnet-5-5`, set by `AGENT_MODEL`. Screenshots are 1280 by 800 JPEG at quality 70.

### 3.2 What it may do

Keyboard only, like a person without a mouse:

- `press`: Tab, Shift+Tab, Enter, Space, Escape, or an arrow key
- `type`: up to 40 characters of test text into the focused field. The text comes from a fixed list such as "Test name" or "test@example.com". The agent cannot choose free text, so it can never enter anything real.
- `zoom`: set a 320 CSS pixel wide window, which equals 400% zoom on a 1280 pixel screen, then back
- `spacing`: apply WCAG 1.4.12 text spacing (line height 1.5, paragraph spacing 2, letter spacing 0.12, word spacing 0.16), then remove it
- `look`: take a fresh screenshot
- `claim`: report a possible failure of one of the measured kinds in 3.4, naming the element it means
- `judge`: report a judgement finding of one of the kinds in 3.5
- `done`: finish the page

There is no mouse action. Any other action the model asks for is refused and counted as a step.

Limits per page: 20 steps and 90 seconds. Whichever comes first ends the page, and the result is marked "partly tested".

### 3.3 Safety on other people's sites

While the agent works on a page:

- Every request that is not GET or HEAD is aborted. This stops form submissions, logins, basket changes and purchases.
- Navigation to another host is aborted. It is allowed only to the same host and its www twin, the same rule the scanner uses today.
- Downloads are refused. New windows and pop-ups are closed. `alert`, `confirm` and `prompt` dialogs are dismissed.
- The existing private-address guard (`net.ts`) still applies.
- If Enter or Space on a link moves to another page of the same site, the agent comes back to the page under test. That other page is not tested as a side effect.

### 3.4 Measured findings (failures and "Check by hand")

The agent's `claim` is never trusted on its own. `measure.ts` checks it in real Chrome, with no AI involved:

| Kind | WCAG | The measurement | Proven: failure | Borderline: Check by hand |
|---|---|---|---|---|
| `legible-keyboard-trap` | 2.1.2 (A) | From the named element, press Tab 30 times, then Shift+Tab 30 times, then Escape and Tab. Record every element that gets focus. | Focus never leaves a set of 6 or fewer elements while focusable elements outside that set exist | The set grows but never reaches the rest of the page |
| `legible-focus-visible` | 2.4.7 (AA) | Screenshot the element's box plus 8 pixels, unfocused and focused, and count the pixels that changed | Under 0.5% of pixels changed | 0.5% to 3% changed |
| `legible-reflow` | 1.4.10 (AA) | At a 320 pixel wide window, compare the page's scroll width with its window width, and find the elements that stick out | The page scrolls sideways by more than 4 pixels because of ordinary content | The only wide items are tables, maps, video, canvas, `pre` or code, which WCAG allows |
| `legible-keyboard-reach` | 2.1.1 (A) | List the elements that have a click handler (Chrome DevTools `getEventListeners`) and a pointer cursor, are visible, and are never reached by Tab | (never a failure) | Each unreachable element |
| `legible-text-spacing` | 1.4.12 (AA) | With text spacing on, find text boxes that clip their own text (`scrollHeight` over `clientHeight` with overflow hidden) | (never a failure) | Each clipped box |

The keyboard trap, reflow and keyboard reach measurements run on every page whether or not the agent claims anything. They are cheap, and they mean a page gets these checks even when the AI stops early. Focus visible is measured for every element Tab reaches, up to 60 per page.

How the results are stored (the contract in `worker/src/types.ts` and `src/types/scan.ts`; all new fields are optional, so older scans still load):

- A proven failure becomes a `RawRule` in `page.violations`, with the kind as its `id`, WCAG tags (for example `["wcag2a", "wcag212"]`), the element's HTML and selector, and a `screenshot` id on the node.
- A borderline result becomes a `RawRule` in `page.incomplete`, the existing "Check by hand" list.
- A measurement that ran and found nothing is recorded in `page.passes`. The score then treats these checks exactly like axe-core rules, which keeps the existing score formula (`scoreFrom`) unchanged.
- Each kind gets a catalogue entry in `src/lib/rules/catalogue.ts`, written in the same plain English. The catalogue test is extended to require them.

### 3.5 The agent's review (judgement findings)

Kinds: `image-description` (alt text that does not describe the image), `link-purpose` (link or button wording that does not say where it goes, in context), `heading-fit` (a heading that does not describe its section), `error-help` (a form error that does not say how to fix it, shown only when the page shows errors without a submit), `captions` (a video with no captions or transcript in sight).

- Each `judge` carries the element, a short reason and a cropped screenshot.
- `review.ts` then asks the model again, in a fresh conversation with a different prompt: "Here is the element and its context. Is this a problem for a disabled person, yes or no, and why?" The finding is kept only if this second pass also says yes.
- Kept findings are stored in `page.agent.reviews`, not as rules. They never touch the score.
- The report gets a new section, "The agent's review". It lists each finding with its screenshot and reasoning, and says that these are the agent's judgement, not measured failures. The wording goes to the owner for approval.

### 3.6 The result of one page

```ts
interface AgentPageResult {
  status: "tested" | "partly" | "failed" | "off";
  reason?: string;           // "step limit", "time limit", "model error", "daily cap"
  steps: number;
  reviews: AgentReview[];    // kept judgement findings (3.5)
  usage: { inputTokens: number; outputTokens: number };
}
```

The `RawScan` gains `agent?: { model: string; usage: {...}; costUsd: number }`. Screenshots are not stored inside `raw`. The worker sends them separately, and the site keeps them in a `scan_shots` table, so `raw` stays under its size limit.

### 3.7 Free scan time

The scan time goes from about 15 to 40 seconds to about 3 to 6 minutes for 6 pages. Pages are tested one after another, as today. The worker still runs at most 2 scans at once.

## 4. Spending (phase 2)

- New table `agent_spend`: `scan_id`, `kind` (`free`, `paid`, `chat_free`, `chat_paid`), `input_tokens`, `output_tokens`, `cost_usd`, `created_at`. RLS is on, with no policies, like every other table.
- The cost is calculated from the tokens and the prices in settings: `AGENT_PRICE_INPUT_PER_MTOK` and `AGENT_PRICE_OUTPUT_PER_MTOK`. These have no built-in defaults. If they are missing, the agent stays off, so a wrong guess can never under-count spending.
- Before dispatching a free scan, `startScan` adds up today's `free` and `chat_free` spend (UTC). Under `AGENT_DAILY_CAP_USD` (default 10), the job goes out with `agent: true`. At or over it, the job goes out with `agent: false`, and the result page says that the agent's tests were not included today.
- Two scans run at once, so the cap can be passed by at most the cost of two scans. The monthly limit the owner sets in the Anthropic console is the final backstop.
- No API key set: the agent is off everywhere, and the site looks and works exactly as it does today.

## 5. Whole-site paid testing (phase 3)

- `fulfil()` dispatches a new worker job, `/jobs/full`, with the scan id, the start address and the 6 pages already done.
- `worker/src/crawl.ts` walks the site's links breadth first on the same host, with the existing skip rules (login, search, basket, settings, tracking links, files). It respects robots.txt, waits 1 second between pages and stops at 50 pages.
- Each page goes through axe-core plus the agent. Each finished page is posted back on its own (message type `page`), and the site stores it in a new `full_pages` table. Sending pages one by one keeps every message small and lets a restart resume where it stopped: the job is sent again with the pages already done.
- The spending stop is `AGENT_REPORT_CAP_USD` (default 15) per report. When it is reached, testing stops and the report says how many pages were covered.
- `buildReport` stays pure. The report page builds one `RawScan` from `scans.raw` plus `full_pages` (de-duplicated by address) and passes it in.
- While testing runs, the report shows the existing 6 pages straight away, with a note saying how far the full test has got. When it finishes, the customer gets one email saying the full report is ready (a new template, wording for approval). The PDF is generated from the finished report.

## 6. Live view and chat (phase 4)

### 6.1 Live view

- The worker sends an event at each agent step: the page, the step number, the action and a one-line note, with a small JPEG frame at most every 3 seconds.
- The site keeps the latest frame per scan in `scan_live` and the last 200 events in `scan_events`.
- The result page polls `GET /api/scans/[id]/live` every 2 seconds while the scan runs. It returns the status, the page list with each page's state, the latest note and the frame's address. This is the same polling the page uses today, and it needs no extra service on Vercel.

### 6.2 Chat

- `POST /api/scans/[id]/chat` runs on the site with the Anthropic SDK. Its context is a compact summary of that scan's report (the findings, pages and reviews) plus the recent live events while testing.
- The instructions: answer only about this site's results and accessibility, and decline anything else politely. Never say or imply that a site is "compliant" or "legally safe"; use the approved disclaimer wording instead. Plain English, British spelling, short sentences.
- The site also checks each answer before showing it. If it contains a banned phrase, the answer is replaced with a safe one that includes the disclaimer.
- Limits are counted in a new `chat_messages` table: 5 questions per free scan, and 100 per paid report (`CHAT_FREE_LIMIT` and `CHAT_PAID_LIMIT`). Free chat counts toward the daily cap. When the cap is reached, free chat says it will be back tomorrow.
- Chat history is saved per scan, so it survives a reload. It is visible only through the scan's private link, as results are today.

### 6.3 Our own accessibility

The chat and live view must be usable by keyboard alone, and their focus order must follow the reading order:

- New answers are announced through a polite live region.
- Each frame has a text description built from the agent's note.
- Animation follows `prefers-reduced-motion`.
- The new screens are added to the WCAG checks we already run on our own pages, plus a keyboard-only test.

### 6.4 Design

A mockup in the Nocturne style goes into the owner's design doc for approval before any screen is built. The same goes for all new customer-facing wording: report sections, notes, the email and the chat's fallback answers.

## 7. When things go wrong

| Situation | What happens |
|---|---|
| The AI is slow, down or returns something invalid | That page keeps its axe-core and measurement results, with `agent.status` set to `"failed"` and the reason stored. The report says "The agent could not finish testing this page." The scan goes on. |
| Step or time limit | `"partly"`. What was confirmed is kept. |
| A claim fails its measurement | Dropped. It is not shown as a failure. |
| The second review pass says no | Dropped. |
| Site blocks bots, needs a login, times out | The same reasons as today. |
| Daily cap reached | Free scans run without the agent and say so. Free chat pauses until midnight UTC. Paid work is unaffected. |
| Worker restarts during a paid job | The job is sent again and resumes from the last stored page. |
| No API key or no prices set | Agent off. Everything works as it does today. |

## 8. Testing

1. **Fixture pages, each with one known problem.** New pages in `tests/fixtures/site`: a keyboard trap, invisible focus, a layout that breaks at 320 pixels, a wide data table (allowed), text that clips with wider spacing, a clickable `div` that Tab cannot reach, an image whose alt text does not match the image, vague links, and one clean page.
2. **Measurement tests** in real Chrome, with no AI involved. Each problem page must produce its finding, and the clean page and the allowed table must produce none.
3. **ReplayModel** with recorded agent answers, so every test runs without a key, without cost and with the same result each time. It includes deliberately wrong answers, for example claiming a trap on the clean page, to prove that measurement drops them.
4. **Safety tests:** a fixture form with POST and a link to another host. The tests check that nothing is submitted and that the agent never leaves the site.
5. **Contract and report tests:** agent rules reach the score, the "Check by hand" list and "The agent's review", and older scans without agent fields still build the same report.
6. **Spending tests:** the agent switches off at exactly the cap, paid work ignores the cap, the $15 stop works, and missing prices keep the agent off.
7. **Chat tests:** the 5 and 100 limits, off-topic questions refused, and banned phrases replaced.
8. **Our own accessibility:** the new screens pass the existing WCAG and keyboard tests.
9. **Real sites, once the key is in:** about 10 sites are tested, including gov.uk (known good) and the W3C "bad" demo (known bad). Their findings are compared by hand, and the real cost per page is measured and reported to the owner before launch.

## 9. Not in this project

- Mouse and touch testing.
- Reading pages with a real screen reader. The agent reads the page and its accessibility tree, which is close but not the same.
- WCAG 2.2 criteria.
- PDF and other documents linked from the site.
- Pages behind a login.

## 10. Settings the owner adds

Worker (`worker/.env`, later Railway): `ANTHROPIC_API_KEY`, `AGENT_MODEL`.

Site (`.env.local`, later Vercel): `ANTHROPIC_API_KEY`, `AGENT_PRICE_INPUT_PER_MTOK`, `AGENT_PRICE_OUTPUT_PER_MTOK`, `AGENT_DAILY_CAP_USD`, `AGENT_REPORT_CAP_USD`, `CHAT_FREE_LIMIT`, `CHAT_PAID_LIMIT`.

The owner pastes the key and the current prices from the Anthropic pricing page. Defaults exist only for the caps and limits.
