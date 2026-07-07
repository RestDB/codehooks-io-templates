# Email Newsletter — architecture notes

A self-hosted newsletter & waitlist service on [Codehooks.io](https://codehooks.io). Double opt-in signup, list management, Markdown or plain-text campaigns, brandable admin UI. All backend logic lives in `index.ts`; there is no build step beyond what `coho deploy` does.

## Layout

- `index.ts` — every route, worker, and job (single file). Public signup/confirm/unsubscribe, the admin API (`/admin/api/*`), the `sendEmail` worker, the `importBatch` worker, and the hourly retry-sweep job.
- `lib/templates.ts` — email HTML/text builders. `confirmationEmail`, `newsletterEmail` (branded HTML), `newsletterText` (plain text). Contains the XSS-guard helpers (`safeColor`, `safeUrl`, `escapeHtml`) since settings are admin-set but render to untrusted recipients.
- `lib/settings.ts` — runtime-editable `AppSettings` (branding, sender, footer, `baseUrl`, `maxPerHour`, `sendingPaused`). Stored in the DB, read via `getSettings()`.
- `lib/providers/` — pluggable email backends. `types.ts` defines `EmailProvider`/`EmailMessage`/`SendResult`; `mailgun.ts` and `brevo.ts` implement them; `index.ts` selects one by the `EMAIL_PROVIDER` env var and exposes the unified `sendEmail()`. **Add a provider** by implementing `EmailProvider` and registering it in `providers/index.ts` — nothing else talks to the provider directly.
- `lib/tokens.ts`, `lib/validation.ts`, `lib/rate-limit.ts`, `lib/pages.ts` — token gen, zod input schemas, per-IP limits, public HTML pages.
- `public/admin.html` — the entire admin SPA (single file, Tailwind CDN + `marked` for Markdown). Client-side previews in here **mirror** the server templates in `lib/templates.ts` — keep them in sync when you change either.

## Delivery model (the important part)

Sending is a **durable outbox**, not fire-and-forget. `POST /admin/api/send` creates a `campaigns` row and enqueues one `sendEmail` task per confirmed subscriber. The `sendEmail` worker:

- Uses the `email_log` collection as the outbox — one row per `(campaignId, to)`, which is both the audit log and the retry source. An already-`sent` row is skipped, so re-enqueues never double-send (idempotent).
- Success → `sent`. Transient (5xx/network) → `pending`, retried up to `MAX_SEND_ATTEMPTS`. Permanent 4xx → `failed` immediately.
- Provider rate-limit (429/420/403-probation) → keeps the row `pending` **without** burning an attempt and trips a global cooldown (`send_cooldown_until` in the `ratelimit` keyspace) so other sends back off.
- Proactive pacing: `settings.maxPerHour` caps sends per clock hour; over-cap messages stay `pending` for the next sweep.
- The hourly job (`0 * * * *`) re-enqueues still-`pending` rows. `SENDING_PAUSED` env or `settings.sendingPaused` is a kill-switch that drains the queue without contacting the provider.

Recovery endpoints: `/admin/api/campaigns/:id/redrive` (reset `failed`→`pending` and re-enqueue) and `/cancel` (stop remaining sends).

Runs `workers: 1` (serial) so it's safe on the free plan; raise workers on paid plans.

## Campaign formats

Campaigns carry a `format` field: `'html'` (default) or `'text'`.

- **html** — the Compose body is Markdown, rendered client-side (`marked`) into `body`, wrapped in the branded template (`newsletterEmail`). `bodyMarkdown` holds the editable source.
- **text** — the body is sent **verbatim, no Markdown** (`newsletterText`) as a `text/plain`-only email (no HTML part), so it reads like a personal note. `EmailMessage.html` is omitted; providers send only the `text` part.

Both formats keep the one-click `List-Unsubscribe` header and a footer with the CAN-SPAM company/mailing address + unsubscribe link. When adding a format or changing footers, update **both** `lib/templates.ts` and the preview builders in `public/admin.html`.

## Working on this

- Deploy: `coho deploy` (~5s to live). Logs: `coho logs --follow`. State/collections: `coho doctor`.
- Required env: `JWT_SECRET`, `ADMIN_PASSWORD`, provider keys (`MAILGUN_*` or `BREVO_API_KEY` + `EMAIL_PROVIDER`). See `.env.example`.
- No `fs`/`path`/`os` — Codehooks has no filesystem. Uploaded images live in the Codehooks filestore.
- `getMany()` returns a stream — `.toArray()` before sorting/mapping.
