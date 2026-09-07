# Changelog

Notable changes to the Codehooks.io templates in this repository.

This file starts with the `form-backend` release. Earlier entries are reconstructed from git history
and record when each template first landed, not every change made to it since. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); dates are ISO 8601.

Each template carries its own `version` in its `package.json`.

## [Unreleased]

### Fixed

- **`form-backend`** — `stats.total` and `stats.lastSubmissionAt` have never worked, on any version.
  This datastore does not interpret dot notation in an update as a path into a nested object, so
  `$inc: { 'stats.total': 1 }` was creating a top-level field literally *named* `stats.total` and
  leaving `stats.total` at zero — silently. Counters are now stored flat (`statsTotal`, `statsSpam`,
  `statsLastSubmissionAt`) where `$inc` is atomic, and composed back into the public `stats` object on
  read, so the API shape is unchanged. An existing deployment keeps its true count with no migration:
  the stray key is frozen and is summed with the new counter.
- **`form-backend`** — the hourly redrive never re-drove anything. `enqueueFromQuery` puts the matched
  document in `body.payload`, not the `{ deliveryId }` wrapper the immediate enqueue uses, so every
  redriven row resolved to `undefined`: the worker re-sent the notification and then failed its status
  write with `NOT_FOUND`, every hour, without ever recording a result. Found in deployed logs, not in
  tests — the payload shape is the platform's. The worker now accepts both shapes and stops if given
  neither.
- **`form-backend`** — a configuration error is no longer counted as a delivery attempt. A missing
  `BASE_URL` was made *transient* rather than permanent, but it still spent one of the five attempts
  on every hourly redrive, so a row was terminally `failed` about four hours after the submission:
  deploy on Friday without `BASE_URL`, set it on Monday, and the entire weekend was already
  unrecoverable. A missing `BASE_URL`, a missing provider key and an unknown `EMAIL_PROVIDER` now
  park the row without spending an attempt, bounded by 12 deferrals (about five days) so a parked
  row cannot cycle forever.
- **`form-backend`** — failed deliveries are reachable again.
  `GET /admin/api/forms/:id/deliveries` was hardcoded to the five newest rows with no pagination,
  and a delivery `_id` is the only input the retry endpoint takes — so a weekend of forty failed
  notifications left thirty-five of them unrecoverable by any route short of a datastore query. The
  listing now takes `limit`/`offset`/`status` and reports `hasMore`, and
  `POST /admin/api/forms/:id/deliveries/retry-all` re-drives a whole form's backlog in one action.
- **`form-backend`** — the per-row backoff was inert, and this changelog and the README both claimed
  otherwise. A `429` stamped a flat 15-minute deadline, but the redrive job runs **hourly**, so the
  deadline had always elapsed by the time the job looked: 500 rate-limited rows re-fired together
  every hour exactly as before. The wait now doubles with each deferral of the same row (15m → 24h)
  with up to 25% random jitter so a backlog does not re-synchronise, and a provider's `Retry-After`
  wins whenever it is longer. From the third deferral the wait exceeds the job interval, which is
  what makes the claim true.
- **`form-backend`** — **Retry now** is no longer offered where it can only do harm. On a `pending`
  row that is due it raced the running worker into two identical emails; on a row addressed to an
  unusable recipient it could never succeed — the row still carries the rejected address — and it
  overwrote `Not a valid email address: …`, the one thing that made the row diagnosable, with a
  generic provider message. Both are refused with a reason the panel prints where the button was.
  A `pending` row that is *not* due stays retryable: that is the recovery path after fixing config.
- **`form-backend`** — a successful retry no longer looks like a no-op. The confirmation message was
  set and then erased synchronously by the refresh that followed it, so the only visible outcome of
  clicking **Retry now** was nothing at all.
- **`form-backend`** — notification recipients are validated when saved. A mistyped address used to
  save cleanly and then be dropped at send time with no delivery row at all, which looked exactly like
  notifications being switched off. `PATCH` now rejects the update and names the address, and an
  unusable address that reaches delivery leaves a terminal row with the reason.
- **`form-backend`** — a `notify.email.recipients` that is not a list is no longer silent. Any
  non-array value produced no target, no rejection and therefore no delivery row, so a form whose
  `recipients` was the bare string `"owner@example.com"` — saved by curl before the `PATCH` gate
  existed, or written straight to the datastore — sent nothing and showed nothing, which is the exact
  symptom that validation was added to eliminate. A bare string is now treated as one address; any
  other shape leaves a visible rejection.
- **`form-backend`** — `PATCH /admin/api/forms/:id` validates the shape of `notify` before writing
  into it. `PATCH {"notify":{"email":"a@b.com"}}` made the handler throw
  `TypeError: Cannot create property 'recipients' on string`; the client received **HTTP 200** with
  `{"text":"Unhandled Codehook exception","fatal":true}`, so a caller checking the status code read
  a failed update as a successful one. Both shapes now return a 400 naming the cause.
- **`form-backend`** — field names, uploaded filenames and submission metadata are line-break
  normalised in the notification body. Only field values were, so a field literally named
  `msg\n\n--- files ---\n…` rendered a forged attachment section, with an attacker-controlled URL,
  above the genuine signed links.
- **`form-backend`** — the `deliver` worker now really does re-check `submission.status === 'spam'`, as
  its caller's comment had always claimed. Reclassifying a submission as spam while its delivery row
  was still pending previously sent the email anyway on the next redrive.
- **`form-backend`** — a `honeypot` name that collides with a real field is rejected on `PATCH`.
  Setting it to `email` silently marked every genuine submission as spam, stripped the value, and sent
  nothing, while returning `200` throughout.
- **`form-backend`** — the notification email carries the link to the submission that the design
  specifies.
- **`form-backend`** — the health endpoint moved from `/health` to `/status`. The platform serves its
  own `/health` (returning `Alive`) which shadows any route an app registers there, so the template's
  endpoint never ran. Caught by a fresh-install test after release.

### Added

- **`form-backend`** — headless form backend. One endpoint per form (`POST /f/:formId`), works with no
  JavaScript on the page, and accepts JSON, urlencoded and multipart with file uploads. Optional typed
  field validation, a server-side domain allowlist, admin JWT auth with login throttling, a submission
  inbox API (search, status, star, notes), authenticated file download, and CSV export with formula
  injection neutralised. Ships a live example client in `form-backend/example/`.
  116 unit tests, no build step. ([#15](https://github.com/RestDB/codehooks-io-templates/pull/15))
- **`form-backend`** — email notifications on submission, via Brevo or Mailgun. Per-form
  `notify.email` settings (recipients, subject template, attach-files toggle), attachments packed
  against a configurable size budget with a signed, expiring download link for anything left out,
  `Reply-To` set automatically to the submitter's own address, and automatic retry of transient
  provider failures via an hourly redrive — a spam-flagged submission never enters the pipeline.
  262 unit tests. Verified end to end against a live deployment: the honeypot path producing no
  delivery row and no send, the signed download link resolving to the correct bytes under a configured
  `BASE_URL`, and a live provider send reaching `status: "sent"` through Brevo. See the deliverability
  notes in `form-backend/README.md`.

## 2026-09-07

### Added

- **`form-backend`** — an admin dashboard at `/setup/` replaces the old settings-only page. Three
  panes: a forms rail with an unread count per form, a submission list with search, status and date
  filters and pagination, and a record pane showing every submitted field, uploaded files, metadata
  and notes, with triage actions (star, reply by `mailto:`, mark read, archive, spam, delete).
  Settings — the snippet, notifications, delivery diagnostics, the allowed-origins list and delete —
  moves into a tab of the same page rather than being the whole page. Below the `lg` breakpoint
  (1024px) the forms rail collapses into a listbox and the list and record panes stack. Built on
  Tailwind's play CDN and DM Sans from Google Fonts rather than a self-contained stylesheet: three
  third-party requests (`cdn.tailwindcss.com`, `fonts.googleapis.com`, `fonts.gstatic.com`), which
  means the dashboard needs network access to render styled — blocked, it still loads, signs in and
  works, just unstyled. Nothing else is affected: the submit endpoint, `/admin/api/*` and stored
  submissions are untouched either way. Two small backend additions carry the new UI: the
  submissions list route now reports `total`/`exact` outside search too, and
  `GET /admin/api/forms` reports each form's unread count — both from a capped, projected scan, since
  the datastore has no filtered `count()`. 383 unit tests.

## 2026-07-05

### Added

- **`email-newsletter`** — self-hosted newsletter and waitlist service with double opt-in, list
  management, Markdown campaigns and a brandable admin UI.

## 2026-03-11

### Added

- **`webhook-inspector`** — catch, inspect and replay webhooks; a self-hosted RequestBin alternative.

## 2026-02-22

### Added

- **`react-admin-dashboard`** — data-driven admin dashboard with dynamic CRUD from a JSON datamodel,
  role-based auth and a visual datamodel editor.

## 2026-01-13

### Added

- **`saas-metering-webhook`** — usage metering with multi-tenant event capture, batch aggregation and
  HMAC-signed webhook delivery.

## 2026-01-10

### Added

- **`webhook-paypal-minimal`** — minimal PayPal webhook handler.

## 2025-12-27

### Added

- **`drip-email-workflow`** — 3-step drip campaign with SendGrid/Mailgun, subscriber management and
  scheduled delivery.

## 2025-11-23

### Added

- **`webhook-delivery`** — outbound webhook delivery with queue-based processing, retries and HMAC
  signing.

## 2025-11-16

### Added

- Minimal webhook handlers: **`webhook-github-minimal`**, **`webhook-stripe-minimal`**,
  **`webhook-discord-minimal`**, **`webhook-shopify-minimal`**, **`webhook-slack-minimal`**,
  **`webhook-clerk-minimal`**, **`webhook-twilio-minimal`**.

## 2025-11-15

### Added

- **`slack-memory-bot`** — Slack bot with pluggable keyword and vector memory adapters.
- **`stripe-webhook-handler`** — production Stripe webhook handler in TypeScript with signature
  verification and event storage.
- **`static-website-tailwindcss`** — static site starter with Tailwind CSS.

## 2024-07-28

### Added

- **`react-bff`** — backend-for-frontend pattern with a React application.

## 2024-07-10

### Added

- **`crud-api-backend`** — CRUD API database backend over the Codehooks NoSQL REST API.
