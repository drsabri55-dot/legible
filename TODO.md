# Legible: build checklist

The brief's build order (section 9), adapted to the stages agreed in
docs/superpowers/specs/2026-09-19-legible-design.md.

## Built and tested

- [x] Step 0: CLAUDE.md, TODO.md, .env.example
- [x] Step 1: Next.js 16 scaffold (TypeScript, App Router, Tailwind v4, ESLint, Prettier, src/)
- [x] Landing page from the Nocturne v2 design, approved copy, reduced-motion support
- [x] Step 2: scan worker (worker/): Express + Playwright + axe-core, WCAG 2.0/2.1 A and AA, home page + 5 nav pages,
      30-second page timeout, robots.txt, LegibleBot user agent, private-network guard on every request, queue of 2
- [x] Step 3: free result page: score ring, counts by severity, two sample issues, locked remainder, email capture
- [x] Step 4: database schema with row level security (supabase/migrations/0001_init.sql)
- [x] Step 5: Stripe Checkout for the $99 report, webhook that ignores repeated events (test checkout in development)
- [x] Step 6: report page styled for A4, cover disclaimer, summary, must/should/nice groups, corrected code,
      limitations page; PDF made by the worker, on demand, from the stored scan
- [x] Step 7: emails (report ready with PDF, day-3 monitoring offer, monthly result template), unsubscribe,
      templates in emails/
- [x] Account area: sign-in by emailed link, past reports, email preferences
- [x] Owner dashboard (/admin): scans ÷ paid reports, the one metric
- [x] Step 8 (first pass): rate limits per IP and per site, SSRF guard in site and worker, same-origin checks,
      secrets for worker and cron, security headers, reports kept out of search engines
- [x] Tests: 94 unit/database, 7 worker, 16 end-to-end (whole journey, accessibility of our own pages, security)

## Needs the owner

- [ ] Accounts and keys: Supabase (DATABASE_URL), Stripe (keys + webhook), Resend (key + verified domain),
      worker host (Railway, Render or Fly), Vercel project
- [ ] Legal text for /terms and /privacy (the gaps are marked on the pages)
- [ ] CONTACT_EMAIL, OWNER_EMAIL, COMPANY_ADDRESS, ADMIN_EMAILS
- [ ] Domain name

## Before launch

- [ ] Apply the migration to Supabase: `npm run db:migrate` with DATABASE_URL set
- [ ] Deploy the worker (worker/Dockerfile) and set its WORKER_SECRET and APP_URL
- [ ] Vercel Pro plan before taking real money (Hobby is non-commercial)
- [ ] Stripe live mode, webhook endpoint https://<domain>/api/stripe/webhook for
      checkout.session.completed and checkout.session.async_payment_succeeded
- [ ] One real purchase end to end in Stripe test mode, then live
- [ ] Error tracking (Sentry) if wanted
- [ ] Remove ALLOW_FAKE_PAYMENTS and ALLOW_PRIVATE_TARGETS from every deployed environment (the code already refuses
      them on Vercel)

## Later (after the first 10 report sales)

- [ ] Monthly monitoring with billing ($39/month) and the change email
- [ ] Agency plan
