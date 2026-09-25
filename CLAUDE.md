@AGENTS.md

# Legible
A small business enters its website address, gets a free accessibility score (WCAG 2.1 AA; home page plus up to 5
navigation pages) and pays $99 for a full plain-English report (web page + PDF). The REPORT is the product, not the
scanner: when in doubt, make the report clearer rather than the scanner cleverer.

## Stack
Next.js 16 App Router + TypeScript + Tailwind v4 in src/ · Postgres through DATABASE_URL (Supabase in production,
embedded Postgres locally) · worker/ = Express + Playwright + axe-core (scans and PDFs) · Stripe Checkout · Resend · Vercel.
Rule wording: src/lib/rules/catalogue.ts · report maths: src/lib/report/model.ts · all SQL: src/lib/data.ts · emails: emails/.

## Legal phrasing (non-negotiable)
Never state or imply a site "is compliant" or "legally safe". Say it "identifies issues measured against WCAG 2.1 Level AA".
Disclaimer on the landing footer, result page, PDF cover and terms. Limitations page in every report. No overlay widget, ever.

## Coding rules
One job per change; explain the plan first when a change touches more than two files. Commit after every working step.
Write the test first where it makes sense (npm test, npm run test:e2e). Never mix payment logic and product logic in one change.
No secrets in the repo: environment variables only, listed in .env.example. Ask before guessing a product decision.
Copy: British spelling, short specific sentences, no em-dash chains, no "not X, but Y" constructions.
