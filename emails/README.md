# Email templates

Each file is one email. Edit the words freely.

- The first line sets the subject: `<!-- subject: ... -->`
- `{{name}}` is replaced with a value when the email is sent. Keep the names as they are.
- Styles are written inline because most email apps ignore style sheets.

| File | When it is sent | Values |
|---|---|---|
| `sign-in.html` | Someone asks for a sign-in link on /account | link, email |
| `free-result.html` | A visitor asks us to email their free score | site, score, total, pages, result_link, price, app_url |
| `report-ready.html` | Straight after payment, with the PDF attached | site, score, total, must, report_link, account_link, amount |
| `monitoring-offer.html` | Three days after the report, once, unless unsubscribed | site, price_monthly, monitor_link, unsubscribe_link, company_address |
| `monitoring-result.html` | Monthly monitoring (not switched on yet) | site, score, previous_score, fixed, new, report_link, unsubscribe_link, company_address |
| `owner-alert.html` | To OWNER_EMAIL when a scan fails or someone asks for monitoring | subject, message, link |

Preview any template at `/dev/emails` while running `npm run dev`.
