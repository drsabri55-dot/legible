# Legible — Product Architecture and Stage 1 (Landing Page) Design

- **Date:** 2026-09-19
- **Status:** Approved in conversation; awaiting review of this written spec
- **Sources:** product brief `PROMPT-01-Accessibility-Compliance-Reports copy.md`; visual design `Legible Nocturne v2.dc.html` (Claude Design project `e3f8ec4b-dbe0-4aff-a4bc-ea7162cf63e6`)

## 1. Summary

Legible is the product described in the brief: a small business enters its website address, gets a free automated accessibility score measured against WCAG 2.1 AA, and pays **$99** for a full report it can act on. The brief's framing holds throughout: the report is the product, not the scanner.

The whole product is built in nine stages. Each stage gets its own design check, is built, run, shown to the owner, committed to git, and then stops for approval. This document fixes the architecture for all stages and specifies **Stage 1 (scaffold + landing page)** in full. Stages 2–9 each get a short design of their own before they are built.

## 2. Decisions made

| Topic | Decision |
|---|---|
| Scope | Full product from the brief, built in stages |
| Brand | **Legible** (the brief's "AccessReport" is retired) |
| Stack | Next.js **16** (App Router) + TypeScript + Tailwind CSS v4. The brief says 15; the owner approved 16 as the current stable release |
| Data, login, files | Supabase (owner has an account) |
| Hosting | Vercel (owner has an account). Hobby while testing; Pro before taking real money, because Hobby is non-commercial only |
| Scan worker | Separate Node service: Express + Playwright + `@axe-core/playwright`, on Railway (or Render/Fly). Runs on the owner's Mac during development |
| Payments | Stripe Checkout, one-time **$99** "Full Accessibility Report" |
| Email | Resend |
| Landing form | One field, **Website address** |
| Copy | Design copy kept except the lines approved in §6.4. British spelling, matching the design |
| Other prices | Unchanged from the brief: monitoring $39/month, agency $149/month (both later stages) |
| Deploy | Nothing goes public without the owner's explicit approval at that moment |

## 3. Architecture

```
legiable/
  src/app/
    layout.tsx                    fonts, metadata, global styles
    page.tsx                      landing page (7 chapters)
    scan/[id]/page.tsx            free result                      (Stage 4)
    report/[id]/page.tsx          full web report, A4 print CSS    (Stage 6)
    account/page.tsx              past reports, magic-link login   (Stage 8)
    terms/page.tsx, privacy/page.tsx                                (Stage 1: placeholders owner fills)
    api/scans/route.ts            POST: validate URL, create scan  (Stage 4)
    api/scans/[id]/route.ts       GET: scan status + free result   (Stage 4)
    api/checkout/route.ts         Stripe Checkout session          (Stage 5)
    api/stripe/webhook/route.ts   idempotent payment handler       (Stage 5)
  src/components/                 UI components
  src/lib/                        shared logic (URL validation, Supabase clients, story engine)
  src/types/                      shared TypeScript types
  worker/                         Express + Playwright + axe-core  (Stage 2)
  supabase/migrations/            SQL: tables + row-level security (Stage 3)
  emails/                         editable HTML email templates    (Stage 7)
  design/                         the original design file, kept for reference and visual comparison
  docs/superpowers/specs|plans/   design documents and plans
```

### Scan flow (target end state)

1. The visitor enters a website address on the landing page.
2. `POST /api/scans` validates that it is a real public `http(s)` address (no private IP ranges, no localhost), applies a per-IP rate limit, stores a `queued` scan in Supabase and hands it to the worker.
3. The worker (at most 2 scans at once, at most 6 pages each: the home page plus up to 5 same-site navigation links, 30-second timeout per page, respects `robots.txt`, identifies itself with a `LegibleBot` user agent) runs axe-core and writes the results back to Supabase.
4. `/scan/[id]` polls until the scan is complete, then shows the score out of 100, issue counts by severity and two sample issues, with the rest blurred behind **Get the full report**.
5. Stripe Checkout takes $99. The webhook records the Stripe event ID before acting, so a repeated event cannot create a second report. It marks the scan paid and asks the worker to render `/report/[id]` to PDF, which is stored in Supabase Storage.
6. Resend emails the report link. Three days later it sends the monitoring offer.

### Build stages

The brief's build order, adapted: the landing page moves to Stage 1, the database comes before the result page so `/scan/[id]` is built once, and the brief's "account area" (listed in §5 of the brief but missing from its §9 build order) gets its own stage.

| Stage | Content | Brief step |
|---|---|---|
| 1 | Scaffold + landing page from the design | 1, part of 3 |
| 2 | Scan worker, standalone, with URL safety checks | 2 |
| 3 | Supabase schema + row-level security | 4 |
| 4 | Scan API + free result page + email capture | rest of 3 |
| 5 | Stripe payment ($99) + idempotent webhook | 5 |
| 6 | HTML report (approved in the browser first) → PDF | 6 |
| 7 | Emails: report ready, day-3 monitoring offer, unsubscribe | 7 |
| 8 | Account area: magic-link login, past reports | brief §5 item 7 |
| 9 | Hardening review (rate limits, SSRF, queue, abuse), Sentry, launch checklist, deploy with approval | 8 |

The one metric (free scans started ÷ paid reports) comes from the `scans` table from Stage 4 onward.

### Legal rules, applied everywhere

- Never state or imply that a site "is compliant" or "is legally safe". The phrasing is always "identifies issues measured against WCAG 2.1 Level AA".
- The disclaimer appears on the landing page footer (Stage 1), on the result page (Stage 4), on the PDF cover and in the terms (Stage 6). Every report has a limitations page.
- No overlay widget, ever.

## 4. Stage 1 — scope

**In:** Next.js scaffold (TypeScript, App Router, Tailwind v4, ESLint, Prettier, `src/` with `app/ components/ lib/ types/`); the landing page reproduced from the design with the approved copy; the website-address form with client-side validation; footer; placeholder Terms and Privacy pages that the owner fills in; automated tests; visual comparison against the original design; `CLAUDE.md`, `TODO.md`, `.env.example` (the brief's Step 0).

**Out (later stages):** any network call from the form. In Stage 1, submitting a valid address shows the status line only. Stage 4 wires it to the scan API. No deployment in Stage 1.

## 5. Stage 1 — how the design is reproduced

### 5.1 Structure

- `src/app/page.tsx` — server component that renders all seven chapters as real HTML, so the text is present without JavaScript and is readable by search engines.
- `src/app/landing.module.css` — the chapter styles, copied value-for-value from the design's inline styles (every `clamp()`, colour, spacing and letter-spacing kept). A CSS module is used here instead of Tailwind utility strings because exact reproduction of about 200 declarations is safer and easier to review this way. Tailwind is used for the rest of the app.
- `src/app/globals.css` — Tailwind v4 plus the Nocturne design tokens (`--color-*`, `--radius-*`, `--shadow-*`) and the `.btn` / `.input` component classes, taken from the design system's `styles.css`.
- `src/lib/story/engine.ts` — the design's animation logic (the `DCLogic` class) ported to a plain TypeScript class with the same maths: starfield, sun, moon texture and approach, landing ground and Earth, ink-in headlines, word-by-word speech reveal, survey hairlines, count-up bars, AA rail, POV vignette, contrast scrim, loading gate, damped scrubbing.
- `src/components/StoryEngine.tsx` — `"use client"` component that starts the engine on mount and stops it on unmount.
- `public/moon-plate.webp` — the moon texture from the design project.
- Inter is loaded with `next/font/google` (self-hosted, no layout shift), weights 400 and 500.

### 5.2 Deliberate differences from the design file

| Design file | Legible site | Why |
|---|---|---|
| Page scrolls inside a fixed-height `div` | The document scrolls normally; the engine reads `window.scrollY` | Normal mobile, keyboard, back-button and scroll-restore behaviour |
| Design-tool knobs (`palette`, `glide`, `score`, `aaLine`) | Fixed at their defaults: Aurora, 1, 68 | Knobs belonged to the design tool |
| Code for five "blob" elements that are not in the markup | Removed | It never ran |
| rAF watchdog and heartbeat for preview hosts that throttle rAF | Replaced by a plain `requestAnimationFrame` loop. As in the design, it keeps running so the scene drifts gently when the reader stops; it pauses while the tab is hidden, and under reduced motion it draws only on scroll/resize | Written for the design tool's preview, not a browser |
| AA marker at 90 on the rail | "0 failures" marker at 100 (end of rail), label placed to the left of the line | Approved copy change; no score implies compliance |
| "Scan a site" is `<a href="#">` | A real `<form>` with a `<button type="submit">` | Works with keyboard and screen readers |

### 5.3 Accessibility of the page itself

The page sells accessibility, so it must pass the same test:

- Split-word headlines and the speech quote carry the full sentence once for assistive technology (`aria-label` on the element, animated word spans `aria-hidden`), so screen readers do not read them word by word.
- Counting numbers (143, 12, 41, 90, 68) expose their final value to assistive technology; the animated digits are `aria-hidden`.
- Canvas, loading gate, chapter counter (`01 / 07`) and vertical edge label are decorative and `aria-hidden`.
- `prefers-reduced-motion`: no loading gate, no drift, no scrubbed animation; all content shows in its final state (the design already does this; kept).
- Visible focus on every control; label tied to the input; error message tied with `aria-describedby` and announced.
- Any colour pair that fails WCAG AA contrast is corrected with the nearest token that passes, and noted in the Stage 1 report to the owner.

### 5.4 Form behaviour (Stage 1)

- Accepts `example.com`, `www.example.com`, `http://…` and `https://…`. Adds `https://` when no scheme is given. Rejects empty input, other schemes, spaces, `localhost`, IP addresses and addresses without a dot in the host name, with the message *"Enter a website address, like yourbusiness.com."*
- On a valid submit, shows *"Scanning yourbusiness.com (up to six pages)…"* using the normalised host name. (Stage 4 replaces this with a real scan and a redirect to `/scan/[id]`.)
- The validation function lives in `src/lib/url.ts` and is unit-tested. Stage 2 and Stage 4 add server-side DNS/IP checks; the client check is only for convenience.

## 6. Stage 1 — approved copy (verbatim)

Lines not listed are exactly as in the design file.

### 6.1 Chrome
- Header: logo mark + **Legible**; chapter counter `01 / 07`.
- Loading gate: `0%` → `100%`, caption *Preparing your read*.
- Vertical edge label: `01 — Launch` … `07 — Landing` (chapter names unchanged).

### 6.2 Metadata
- Title: **Legible — accessibility reports for small business websites**
- Description: *Legible tests your site against WCAG 2.1 AA and shows you exactly what to fix.*

### 6.3 Chapters

**01 · Launch**
- H1: *Every site claims to be accessible. Few are ever read as one.*
- Sub-line: *Legible tests your site against WCAG 2.1 AA and shows you exactly what to fix.*
- Cue: *Scroll to launch*

**02 · The mission**
- H2: *What Legible is, and why the trip is worth taking.*
- Body: *Legible tests your home page and up to five linked pages against WCAG 2.1 AA. The report explains each failure, who it affects and the code change that fixes it.*
- Card 01 — **Readable findings**: *Most scanners return rule IDs and raw code. Legible explains each failure in terms a site owner understands.*
- Card 02 — **Fixes in priority order**: *Every failure comes with the affected element, the WCAG rule it breaks and corrected code, sorted into must fix, should fix and nice to have.*
- Card 03 — **A dated record**: *Re-scan after each release and keep a dated history of your results against WCAG 2.1 AA.*

**03 · The read**
- H2: *What a screen reader hears on a typical checkout page.*
- Quote: *“Link. Empty link. Button, unlabelled. Heading level four, inside nothing.”*
- Body: *Up to six pages per scan. Every link, form label, image and colour pair is checked and traced to the markup behind it.*

**04 · The survey**
- H2: *Stop on one button. This is everything a screen reader is told about it.*
- Labels: *Button has no accessible name* / *Icon has no text alternative* / *Label contrast is 2.3:1, below the 4.5:1 minimum*
- Body: *One button, three failures. The report lists every failure like this one, with its fix.*

**05 · The count** (unchanged)
- `143` *failures, not warnings*
- Critical `12`, Serious `41`, Moderate `90`
- Body: *Twelve of them stop someone from finishing the form today. Everything else queues behind those.*

**06 · The line**
- H2: *AA is the line. You sit under it.*
- Rail: marker counts to `68`; end-of-rail line labelled **0 failures**.
- Label under the rail: *32 points to go. Twelve fixes close most of the gap.*
- Body: *AA is the level regulators cite. Every Legible report measures against it and lists the fixes that close the gap fastest.*

**07 · Landing**
- H2: *Enter your site and we will test it.*
- Body: *You landed. The free scan shows your score, your issue counts and two sample fixes.*
- Body: *The full report covers every failure with corrected code, for a one-time $99.*
- Form: label **Website address**, placeholder *yourbusiness.com*, button **Scan a site**
- Status: *Scanning yourbusiness.com (up to six pages)…*

### 6.4 Footer (new)
- *An independent audit. No overlay widgets.*
- *Legible identifies issues measured against WCAG 2.1 Level AA. Automated testing cannot detect every issue, so manual review is recommended.*
- Links: *Terms* · *Privacy*
- Styled in the design's own small-caps, neutral-500 treatment, placed after chapter 07.

The Terms and Privacy pages are created in Stage 1 with clearly marked sections for the owner's legal text. Claude does not write legal terms.

## 7. Stage 1 — testing

| Check | Tool | Pass condition |
|---|---|---|
| URL validation | Vitest unit tests on `src/lib/url.ts` | All accept/reject cases in §5.4 behave as specified |
| Page renders | Playwright | All seven chapters, footer and form present; no console errors |
| Accessibility | Playwright + `@axe-core/playwright` | Zero violations for WCAG 2.0/2.1 A and AA rules |
| Reduced motion | Playwright with `reducedMotion: 'reduce'` | No loading gate; all chapter text visible without scrolling animation |
| Form | Playwright | Invalid input shows the error; valid input shows the status line |
| Copy | Playwright | Key approved strings in §6 appear exactly |
| Visual fidelity | Screenshots of the original design and the new page at the same scroll points (0, each chapter), desktop 1440×900 and phone 390×844 | Reviewed side by side; differences listed for the owner |
| Build | `next build`, ESLint, TypeScript | No errors |

## 8. Risks

- **Animation port drift.** The engine has many tuned constants. Mitigation: port the maths line for line, do not re-tune, and compare screenshots against the original.
- **Canvas performance on low-end phones.** Mitigation: keep the design's own caps (device pixel ratio ≤ 1.5, sprite blitting) and check frame time in Chrome DevTools on a throttled profile.
- **Copy drift.** Mitigation: §6 is the single source of truth; Playwright asserts the key strings.
