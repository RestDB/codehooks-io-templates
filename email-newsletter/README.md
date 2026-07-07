# Email Newsletter

A self-hosted **newsletter & waitlist** email service on [Codehooks.io](https://codehooks.io). Collect subscribers with double opt-in confirmation, manage lists, compose Markdown campaigns with inline images, and send through [Mailgun](https://www.mailgun.com/) — all from a clean, **fully brandable** admin UI. No code editing required to make it yours: set your logo, colors, sender, and email footer in the Settings page.

## Features

- **Double opt-in signup** — `POST /subscribe` with email + list, sends a confirmation email, confirms via tokenized link
- **List management** — create lists, import existing subscribers in bulk, cascade-delete
- **Campaigns** — compose in Markdown, preview, send to one or more lists; queued delivery with per-campaign sent/failed counts
- **HTML or plain text** — per-campaign format toggle: send the branded HTML template, or a genuine `text/plain` email that reads like a personal note (better for 1:1-style messages and inbox placement)
- **Image uploads** — drag images into campaigns; served from Codehooks filestore
- **Brandable** — app name, logo, primary/heading colors, sender, links, and a customizable email footer (company, mailing address, free text), all editable at runtime in **Settings**
- **Deliverability** — `List-Unsubscribe` headers, one-click unsubscribe, footer address for CAN-SPAM
- **Admin UI** — password login (JWT cookie), subscribers/lists/campaigns/images/settings, mobile-friendly
- **Rate limiting** — per-IP signup limits and confirmation-resend throttling

## Quick start

```bash
# 1. Create a project from this template
coho create my-newsletter --template email-newsletter
cd my-newsletter
npm install

# 2. Set required environment variables
#    Email provider (default mailgun) — see "Email provider" below for Brevo
coho set-env MAILGUN_API_KEY 'key-xxxxxxxx' --encrypted
coho set-env MAILGUN_DOMAIN 'mg.yourdomain.com'
coho set-env MAILGUN_EU 'false'
#    Admin auth
coho set-env JWT_SECRET "$(openssl rand -hex 32)" --encrypted
coho set-env ADMIN_PASSWORD 'choose-a-strong-password' --encrypted

# 3. Deploy
coho deploy

# 4. Find your URL and open the admin
coho info
# → open https://<your-app>.codehooks.io/admin.html
```

See [`.env.example`](.env.example) for the full list of variables (including optional `FROM_EMAIL`, `FROM_NAME`, `BASE_URL`).

## Your first campaign

Once deployed, open `https://<your-app>.codehooks.io/admin.html` and:

1. **Log in** with your `ADMIN_PASSWORD`.
2. **Settings** → set your app name, upload a logo, pick colors, choose the email-brand placement, and fill in the **footer** (company name + a physical mailing address — required for CAN-SPAM). Set **Base URL** to your deploy URL (needed so campaign links work). **Save.**
3. **Lists** → create a list (e.g. `newsletter`).
4. **Collect signups** — point a form at `POST /subscribe` (see [Collecting signups](#collecting-signups)). Each signup gets a confirmation email and is only `confirmed` after clicking the link. (To test, subscribe yourself and confirm.)
5. **Compose** → write your email in Markdown, hit **Preview**, then **Send** to your list.
6. Watch the campaign's sent/failed counts on the **Campaigns** page. Large sends pace automatically at your hourly cap (Settings → Sending).

> **Before a large real send**, read [Deliverability & sending limits](#️-deliverability--sending-limits--read-before-your-first-big-send) — new sending domains are rate-limited and can get suspended if you blast too fast.

## Email provider

Sending is pluggable — choose one provider with the `EMAIL_PROVIDER` env var (default `mailgun`). Set only that provider's variables.

| `EMAIL_PROVIDER` | Required env vars | Notes |
|---|---|---|
| `mailgun` (default) | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_EU` | EU accounts: `MAILGUN_EU=true` |
| `brevo` | `BREVO_API_KEY` | JSON API; free/low tiers cap sends **per day** (e.g. 300/day) |

All three send per-recipient, set `List-Unsubscribe` headers, and report rate limits into the same retry/cooldown safety logic. In every case you must **verify your sending domain** (SPF/DKIM/DMARC) with the provider first, and `FROM_EMAIL` must be on a verified/authorized domain.

**Mailgun:** create a sending domain (e.g. `mg.yourdomain.com`), add its DNS records, copy the Sending API key.

**Brevo:** create an API key (SMTP & API → API Keys) and authenticate your sending domain. Note the **per-day** sending cap on free/low tiers (e.g. 300/day) — large lists pace out over multiple days under the hourly cap. Brevo prices by emails sent (not contact count), which suits owning your own list.

## ⚠️ Deliverability & sending limits — read before your first big send

**New sending domains are rate-limited by every email provider, regardless of your plan.** This is the single biggest gotcha. A brand-new domain that suddenly tries to blast a large list looks exactly like spam, so providers throttle it and **suspend the account** if you exceed the limit — then make you justify your list before reinstating you.

Real example: a domain on a paid **50k/month** Mailgun plan was still capped at **100 emails/hour** on probation. Sending 1,400 at once got the **whole account suspended** (taking down other domains too), and required a support case explaining where the list came from and the intended daily volume.

How this template protects you:

- **Hourly send cap (default 75/hr).** Set in **Settings → Sending** (`Max emails per hour`). The worker paces sends to stay under it — a large campaign automatically spreads over hours instead of tripping the limit. It's **on by default** for exactly this reason. Raise it gradually (and only) as your domain warms up. `0` = unlimited (don't use that on a young domain).
- **Cooldown circuit breaker.** If a provider rate-limits you anyway, the worker reads its "try again" signal and backs off — it won't hammer the API (which resets probation timers and looks abusive).
- **Durable retry + re-drive.** Rate-limited messages are kept `pending` and retried by the hourly sweep, never silently dropped. A campaign's **Re-drive failed** button re-queues any failures.
- **Pause kill-switch.** A "Pause sending" control (Settings) and a `SENDING_PAUSED=true` env var to halt everything instantly if something goes wrong.

Best practices for a healthy sender:

1. **Verify your domain fully** (all DNS records green) before sending.
2. **Warm up:** start small (tens/day), ramp over days/weeks. Raise the hourly cap as you go.
3. **Only email people who opted in.** Providers *will* ask where your list came from.
4. **Keep marketing separate from transactional.** Don't run bulk campaigns and your app's signup/password emails through the same account — a marketing suspension shouldn't take down your product's email. Consider a dedicated transactional provider (e.g. Postmark) for the latter.
5. **Fill in the footer** (company name + physical mailing address, in Settings) — required for CAN-SPAM and expected by providers.

## Make it yours (Settings)

Log in to the admin, click **Settings**, and configure:

| Setting | Used for |
|---|---|
| **App name** | Admin title, emails, and public pages (shown as text when no logo is set) |
| **Logo** | Uploaded image shown in admin, emails, and confirm/unsubscribe pages |
| **Primary / Heading color** | Buttons, links, accents, and headings across UI, emails, and pages |
| **From email / name** | Campaign sender (overrides `FROM_EMAIL` / `FROM_NAME`) |
| **Base URL** | Builds confirm/unsubscribe links in emails — **required for campaigns** |
| **Website URL** | "Back to website" link on public pages |
| **Footer** | Company name, mailing address, and free text shown in every email footer |

Settings are stored in the Codehooks key/value store and take precedence over the environment variables. A fresh deploy works with neutral defaults before you change anything.

## Collecting signups

Point your signup form at the public endpoint:

```bash
curl -X POST https://<your-app>.codehooks.io/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"jane@example.com","list":"waitlist"}'
```

The `list` must already exist (create it in the admin under **Lists**). The subscriber receives a confirmation email and is only marked `confirmed` after clicking the link.

Drop-in HTML form for your own site (replace the URL and list name):

```html
<form id="signup">
  <input type="email" name="email" placeholder="you@example.com" required />
  <button type="submit">Subscribe</button>
  <p id="signup-msg"></p>
</form>

<script>
  document.getElementById('signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const msg = document.getElementById('signup-msg');
    try {
      const res = await fetch('https://<your-app>.codehooks.io/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, list: 'newsletter' }),
      });
      const data = await res.json();
      msg.textContent = data.message || (data.ok ? 'Check your inbox to confirm!' : data.error);
    } catch {
      msg.textContent = 'Something went wrong. Please try again.';
    }
  });
</script>
```

The endpoint is CORS-enabled and rate-limited per IP. On success it returns `{ ok: true, message }`; on error, `{ ok: false, error }`.

## API reference

Public:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/subscribe` | Add a pending subscriber (`{ email, list }`) and send confirmation |
| `GET` | `/confirm/:token` | Confirm a subscription (HTML page) |
| `GET` | `/unsubscribe/:token` | Unsubscribe (HTML page) |
| `GET` | `/branding` | Public, non-secret branding subset (for the login screen) |

Admin (JWT cookie required, obtained via `POST /admin/login`):

| Method | Route | Purpose |
|---|---|---|
| `GET/PUT` | `/admin/api/settings` | Read / update branding & config |
| `GET` | `/admin/api/subscribers` | List subscribers (search/filter/paginate) |
| `DELETE` | `/admin/api/subscribers/:id` | Delete a subscriber |
| `GET/POST` | `/admin/api/lists` | List / create lists |
| `DELETE` | `/admin/api/lists/:id` | Delete a list (and its subscribers) |
| `POST` | `/admin/api/import` | Bulk import emails into a list |
| `POST` | `/admin/api/send` | Create a campaign and queue delivery |
| `GET` | `/admin/api/campaigns` | List campaigns |
| `GET` | `/admin/api/email-log` | Delivery log |
| `GET/POST/DELETE` | `/admin/api/images` | Manage uploaded images |

## Project structure

```
email-newsletter/
├── index.ts              # routes, workers, admin API
├── lib/
│   ├── settings.ts       # branding/config (KV blob) + defaults + env fallback
│   ├── templates.ts      # confirmation & newsletter email HTML
│   ├── pages.ts          # confirm/unsubscribe/error HTML pages
│   ├── mailgun.ts        # Mailgun REST sender
│   ├── tokens.ts         # confirm/unsubscribe token helpers
│   ├── rate-limit.ts     # IP + resend throttling
│   └── validation.ts     # Zod input schemas
├── public/
│   └── admin.html        # single-file admin UI (Tailwind CDN)
└── .env.example
```

## Security notes

- Secrets (`MAILGUN_API_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`) live only in environment variables — never in the database or committed to git.
- The admin UI is protected by a password + signed JWT cookie. Use a strong `ADMIN_PASSWORD` and a random `JWT_SECRET`.
- Only non-secret branding is exposed via the public `/branding` endpoint.
