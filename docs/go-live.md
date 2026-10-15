# Going live: settings for each service

The order matters. Each service needs an address from the one before it. Never commit any of these values.
Values marked **you** are secrets: paste them into the service's own settings page.

## 1. Database (Supabase project `legible`, id `hcxakorfsotuvjyuwiqe`)
- The project pauses when unused. Restore it in the Supabase dashboard before anything else.
- `0001_init` is applied. Apply `0002_scan_shots` to `0005_live_chat` (in order) before the site goes up.
  Phases 3 to 5 need all of them; the site fails on missing tables.
- Run Supabase's security advisor afterwards: every table has row-level security on and no policies.

## 2. GitHub
- An empty private repository named `legible`. Push `full-build`, then merge it into `main`.
  Vercel and Railway deploy from `main`.

## 3. Scanner (Railway)
New project → Deploy from GitHub repo → `legible`. Settings → Root directory: `worker`. It builds from
`worker/Dockerfile` and checks `/health`. Railway sets `PORT`; leave `WORKER_PORT` unset.

| Variable | Value |
|---|---|
| `WORKER_SECRET` | **you**: a long random string (`openssl rand -hex 32`). The same value goes on Vercel. |
| `APP_URL` | The site's address from step 4, e.g. `https://legible.vercel.app`. Set it after step 4, then redeploy. |
| `MAX_CONCURRENT_SCANS` | `2` |
| `ANTHROPIC_API_KEY` | **you**: the same key as on Vercel. Leave empty to run without the testing agent. |
| `AGENT_MODEL` | Leave empty (`claude-sonnet-5-5`). |

Do not set `ALLOW_PRIVATE_TARGETS`.

Then Settings → Networking → Generate domain. That address is `WORKER_URL` below.

## 4. Site (Vercel)
Import `legible` from GitHub (framework Next.js, root directory is the repository root).

| Variable | Value |
|---|---|
| `APP_URL` | The site's own address, e.g. `https://legible.vercel.app` (no trailing slash). |
| `DATABASE_URL` | **you**: Supabase → Connect → Transaction pooler string, with the database password. |
| `SESSION_SECRET` | **you**: `openssl rand -hex 32` |
| `CRON_SECRET` | **you**: `openssl rand -hex 32`. Vercel sends it to `/api/cron/daily` each morning at 09:00 UTC. |
| `WORKER_URL` | The Railway address from step 3. |
| `WORKER_SECRET` | **you**: the same value as on Railway. |
| `ADMIN_EMAILS` | Your email (opens `/admin`). |
| `OWNER_EMAIL` | Your email (alerts when something needs you). |
| `CONTACT_EMAIL` | The address shown to customers. |
| `COMPANY_ADDRESS` | Shown in email footers. |
| `STRIPE_SECRET_KEY` | **you**: Stripe test key, `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | **you**: `whsec_…` from the webhook below. |
| `REPORT_PRICE_CENTS` | `9900` |
| `ANTHROPIC_API_KEY` | **you**: turns on the testing agent, live view, chat and the AI agent page. |
| `AGENT_PRICE_INPUT_PER_MTOK` | The model's input price in dollars per million tokens (Anthropic's pricing page; `2` for Sonnet 5.5 when this was written). |
| `AGENT_PRICE_OUTPUT_PER_MTOK` | The output price (`10` for Sonnet 5.5 when this was written). |
| `AGENT_DAILY_CAP_USD` | `10` |
| `AGENT_REPORT_CAP_USD` | `15` |
| `CHAT_FREE_LIMIT` | `5` |
| `CHAT_PAID_LIMIT` | `100` |
| `RESEND_API_KEY` | Later, with the domain. Until then emails are only logged. |
| `EMAIL_FROM` | Later, e.g. `Legible <reports@yourdomain.com>` |
| `EMAIL_REPLY_TO` | Later. |

Never set on Vercel: `ALLOW_FAKE_PAYMENTS`, `ALLOW_PRIVATE_TARGETS`, `CHAT_FAKE_MODEL` (the site refuses them there anyway).

The landing page is built once, so the AI agent button appears only after a deploy that already has the key and both
prices. After adding or changing any variable: Deployments → Redeploy.

## 5. Stripe webhook (test mode)
Developers → Webhooks → Add endpoint: `https://<site>/api/stripe/webhook`, events `checkout.session.completed` and
`checkout.session.async_payment_succeeded`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.

## 6. Check before telling anyone
- Scan a real site from the landing page. The result, live view and chat should appear.
- `/agent`: type a domain; the chat opens while the scan runs.
- One test purchase with card `4242 4242 4242 4242`: the report opens, the whole-site test starts, its chat allows 100 questions.
- `/admin` signs in with an admin email once Resend is set up (sign-in links are sent by email).
