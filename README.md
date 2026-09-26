# Legible

A small business enters its website address, gets a free accessibility score measured against WCAG 2.1 Level AA,
and pays $99 for a full report with every failure explained and corrected code, as a web page and a PDF.

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

## What is where

| Folder | What it holds |
|---|---|
| `src/app/` | Pages and API routes. `page.tsx` is the landing page. |
| `src/lib/rules/catalogue.ts` | The plain-English text for every issue. Edit wording here. |
| `src/lib/report/model.ts` | How the score, counts and groups are worked out. |
| `src/lib/data.ts` | Every database query. |
| `emails/` | Email templates. Edit the words freely; see `emails/README.md`. |
| `worker/` | The scanner: opens sites in Chromium, runs axe-core, prints PDFs. Deployed separately. |
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

## Going live (with the owner's approval at each step)

1. **Supabase.** Create a project. Copy the connection string (Project Settings → Database → Connection string →
   Transaction pooler) into `DATABASE_URL`. Run `npm run db:migrate` once to create the tables.
2. **Scan worker.** Deploy the `worker/` folder to Railway, Render or Fly using `worker/Dockerfile`. Set
   `WORKER_SECRET` (a long random string) and `APP_URL` (your site's address). Note its public address.
3. **Resend.** Verify your sending domain. Set `RESEND_API_KEY` and `EMAIL_FROM`.
4. **Stripe.** Set `STRIPE_SECRET_KEY`. Add a webhook to `https://<your domain>/api/stripe/webhook` for
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and set `STRIPE_WEBHOOK_SECRET`.
5. **Vercel.** Import the project. Set every variable in `.env.example` (leave `ALLOW_FAKE_PAYMENTS` and
   `ALLOW_PRIVATE_TARGETS` empty). The daily job in `vercel.json` sends the day-3 offer; set `CRON_SECRET`.
   Switch to the Pro plan before taking real money: Hobby is for non-commercial use only.
6. **Legal.** Fill in the marked gaps on `/terms` and `/privacy`.

Stop scanning a site whose owner asks: add its address to the `blocked_domains` table in Supabase.
