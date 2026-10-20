# Legible

A small business enters its website address, gets a free accessibility score measured against WCAG 2.1 Level AA,
and pays $99 for a full report with every failure explained and corrected code, as a web page and a PDF.

With an Anthropic API key, a testing agent also uses each page by keyboard, measures focus, reflow and text
spacing, and tries fixes on the live page, keeping only the ones that work. Visitors can watch it work and ask
questions about their results. The paid report tests the whole site, up to 50 pages.

## Run it on your Mac

You need Node.js 20.9 or newer. Nothing else: the database runs from npm, no Docker.

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

`setup` runs once. It creates `.env.local` and `worker/.env` with safe development values, installs the scan
worker and the Chromium browser it uses. `dev` starts three things together: the database, the scan worker and
the site. Open http://localhost:3000.

In development:

- **Payments** use a test checkout page (no Stripe keys needed, no money moves).
- **Emails** are saved to `.data/outbox/` instead of being sent. The PDF attachment is saved there too.
- **Owner dashboard:** sign in at `/account` with the address in `ADMIN_EMAILS` (`owner@example.com` by default).
  The sign-in link lands in `.data/outbox/`. Then open `/admin`.
- Preview every email template at http://localhost:3000/dev/emails.
- **Testing agent, live view and chat** stay off until you add `ANTHROPIC_API_KEY` and the two
  `AGENT_PRICE_*` values to both `.env.local` and `worker/.env`. Without them, scans run axe-core only.

## What is where

| Folder | What it holds |
|---|---|
| `src/app/` | Pages and API routes. `page.tsx` is the landing page. |
| `src/lib/rules/catalogue.ts` | The plain-English text for every issue. Edit wording here. |
| `src/lib/report/model.ts` | How the score, counts and groups are worked out. |
| `src/lib/data.ts` | Every database query. |
| `emails/` | Email templates. Edit the words freely; see `emails/README.md`. |
| `worker/` | The scanner: opens sites in Chromium, runs axe-core, prints PDFs. Deployed separately. |
| `worker/src/agent/` | The testing agent: keyboard checks, measurements and the live view. |
| `worker/src/fixes/` | Tries each fix on the live page and keeps only the ones that work. |
| `src/lib/chat/` | Questions about a scan: limits, the safety net for legal wording, the model call. |
| `src/lib/spend.ts` | The daily spending cap for the testing agent. |
| `supabase/migrations/` | The database tables. |
| `design/` | The original Claude Design file, for reference. |
| `tests/` | Automated tests. |

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm --prefix worker test
```

To check how Legible handles any real website (pages chosen, score, every issue, and why pages were not scanned):

```bash
npm run qa -- yourbusiness.com another-site.com
```

`npm test` runs the unit and database tests. `test:e2e` builds the site and runs the whole customer journey in a
browser against a small test website with known faults. It also checks our own pages for accessibility failures.

## Going live

Every setting for Supabase, Railway, Vercel and Stripe, in the order they are needed, is in
[docs/go-live.md](docs/go-live.md). Keys and passwords go into each service's own settings page, never into this
repository. Switch Vercel to the Pro plan before taking real money: Hobby is for non-commercial use only.

Stop scanning a site whose owner asks: add its address to the `blocked_domains` table in Supabase.
