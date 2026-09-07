# form-backend — email notifications & spam defence

**Date:** 2026-09-06
**Status:** design, ready for implementation planning
**Builds on:** `docs/superpowers/specs/2026-09-02-form-backend-design.md` (the original design) and
`docs/superpowers/plans/form-backend-carried-forward.md`

The capture half shipped: submissions land in the database and an inbox API can read them back. This
release closes the loop — **you get an email when someone submits, with their files attached** — and
adds the spam defence that makes it safe to leave switched on.

## Why these ship together

Today spam sits harmlessly in a database nobody watches. The moment email notification exists, every
bot submission becomes an email in the owner's inbox, and the first thing they will do is turn the
notification off — removing the feature this release exists to add. Email without spam defence is
worse than no email.

The bar is "stops ordinary drive-by bot spam", not "stops a determined attacker".

## Goals

- An email per submission, to one or more recipients per form, with uploaded files attached.
- `Reply-To` set to the submitter, so replying reaches the person who filled the form.
- Signed, time-limited download links for every file, so oversized attachments are still reachable.
- Honeypot enforcement and per-IP submission rate limiting.
- A durable outbox so a provider outage delays delivery rather than losing it.

## Non-goals

Deliberately excluded. Each is cheap to add afterwards *because* of the Channel interface this
release introduces, and each would enlarge the review surface now:

- Webhook, Slack and Discord channels.
- Autoresponder (a reply to the submitter). It means sending mail to untrusted addresses, which
  carries abuse and deliverability considerations that deserve their own design.
- Content heuristics and CAPTCHA. See "Spam escalation" below for where they fit.
- AI triage, the admin UI, digest/batched notifications, and the retention purge job.

## Architecture

The request path stays fast and answers the visitor. Everything slow or failure-prone happens behind
a durable outbox.

```
POST /f/:formId
  |
  |-- parse body (must remain the FIRST await — see platform constraints)
  |-- per-IP submission rate limit  -> 429 if exceeded
  |-- domain allowlist
  |-- honeypot check                -> if filled: store status='spam', respond success, STOP
  |-- validate
  |-- persist files
  |-- insert submissions{}                      <- visitor's request ends here
  |-- respond 200 JSON | 302
  `-- enqueue processSubmission
        |
        |-- (spam verdict step — a no-op this release; heuristics/AI slot in here later)
        `-- write one deliveries{} row per configured channel
              `-- enqueue deliver x N
                    `-- Channel adapter: email
```

### Spam enforcement runs in the request path

The honeypot is a definitive, synchronous signal, so it is checked before storing. A spam submission
is **stored, marked `spam`, and never enqueued** — so it costs no queue work and generates no email.

The response to a bot is an ordinary success (200 or 302). Telling a bot it was detected only helps
it adapt.

The `processSubmission` verdict step still exists but does nothing this release. It is where content
heuristics and AI triage attach later, without moving the honeypot.

### Never drop, always store

A honeypot false positive means a real person's submission vanishes — a screen reader announcing a
hidden field, or an aggressive password manager. It is rare and the cost is somebody's job
application disappearing silently.

Therefore spam is **stored and visible in the inbox under a spam filter**, never discarded. A false
positive is then recoverable rather than lost.

## Data model

### New collection: `deliveries`

```
submissionId, formId
channel: 'email'
target: string          // the recipient address
status: 'pending' | 'sent' | 'failed' | 'skipped'
attempts: number
lastError: string | null
lastAttemptAt, created, sentAt
```

Keyed by `(submissionId, channel, target)`. The `deliver` worker skips a row already `sent`, so a
re-enqueue can never double-send. `skipped` is terminal and never retried — it means the channel had
nothing to do (no recipients configured), and is distinguished from `failed` so the delivery log does
not show phantom errors.

### Changes to `forms`

```
notify: {
  email: {
    enabled: boolean          // default false — a new form does not email until configured
    recipients: string[]      // validated addresses
    subjectTemplate: string   // default 'New submission: {{form}}'
    attachFiles: boolean      // default true
  }
}
honeypot: string              // BECOMES writable (see below)
```

`honeypot` is currently locked out of the PATCH allowlist precisely because nothing enforced it. This
release enforces it, so it becomes writable — and the hardcoded `_gotcha` in `index.ts` and
`lib/validation.ts` must be **derived from `form.honeypot`** instead. A configurable name matters:
`_gotcha` is a Formspree convention and therefore fingerprintable by bots that know to skip it.

`retentionDays` stays locked. Nothing enforces it and no plan owns it yet.

### Changes to `submissions`

No schema change. The existing `status: 'spam'` and `spam: { score, reasons }` fields are finally
written by something: `reasons: ['honeypot']`.

## The provider layer

Lifted from `email-newsletter/lib/providers/` — `types.ts`, `mailgun.ts`, `brevo.ts`, `index.ts`,
selected by the `EMAIL_PROVIDER` env var. The existing interface has **no attachment support**, so
`EmailMessage` gains two fields:

```ts
replyTo?: string;
attachments?: Array<{ filename: string; contentType: string; content: Buffer }>;
```

The two providers differ in how they carry attachments, and this is the main new implementation work:

- **Mailgun** — `multipart/form-data` with one `attachment` part per file.
- **Brevo** — JSON with `attachment: [{ content: <base64>, name }]`.

Nothing outside `lib/providers/` knows which provider is active.

### Attachment size cap

`MAX_ATTACH_MB` (default 10) caps the **total** attachment bytes per email, staying under both
Mailgun's 25 MB and Brevo's lower limit. Files are added largest-last until the budget is exhausted.

Files that do not fit are **not silently dropped**: the email names them and includes their signed
download links. Behaviour is deterministic and unit-testable — given a list of file sizes and a
budget, which files attach is a pure function.

Attachments are read with `filestore.readFileAsBuffer`, not the stream API.

## Signed download links

Every file gets a time-limited link in the email, whether or not it was attached. The existing
download route is admin-JWT-only, so a plain link would not work.

**Minted as a JWT** — `jsonwebtoken` is already a dependency and handles expiry natively. Payload is
`{ sid: submissionId, fid: fileId }` with a 7-day `exp`, signed with `JWT_SECRET`.

**New public route:** `GET /files/:token`. It verifies the token, checks the file still exists on that
submission, and serves it exactly as the admin route does — obtaining the stream *before* setting
headers, using the listener pattern rather than `.pipe()`, with `content-disposition: attachment` and
`x-content-type-options: nosniff`.

This is a **new public surface on attacker-supplied files**, and the design accepts that consciously:

- A token grants access to **one file**, never a submission or a form.
- It expires. A leaked email exposes those files until `exp`, not forever.
- It is unguessable and signature-verified; a tampered token fails `jwt.verify`.
- The response is still `attachment` + `nosniff`, so an uploaded `.svg` or `.html` cannot execute in
  the browser of whoever opens it.

## Spam defence

### Honeypot

The submit handler reads `form.honeypot` (default `_gotcha`) and treats a **non-empty** value as bot
traffic: store with `status: 'spam'`, `spam.reasons: ['honeypot']`, respond success, do not enqueue.

The field name is stripped from stored data and exempt from strict-mode validation — both derived
from `form.honeypot` rather than hardcoded.

### Per-IP submission rate limit

Reuses `lib/throttle.ts`, built for the admin login, under a separate keyspace and keyed by
`(formId, ip)` so one busy form cannot throttle another.

`SUBMIT_RATE_LIMIT` (default 30) per IP per form per hour. Over the limit returns **429** with
`Retry-After` — this is a real error, unlike the honeypot, because a human retrying is the expected
case and silence would be confusing.

Consistent with the login throttle: a throttle-store failure **allows** the request. A key-value
outage must not take a customer's contact form offline.

**Known consequence of the ordering.** Because `parseBody` must be the first awaited call, the rate
limit cannot run until the body is already buffered — so a flood still costs up to `MAX_UPLOAD_MB` of
buffering per request before it is rejected. Bounded and unavoidable given the platform's stream
behaviour; the same trade-off Plan 1 accepted for the form lookup. Rate limiting here protects the
database, the queue and the owner's inbox, not raw bandwidth.

### Spam escalation, for later

Each layer is more effective and more intrusive than the last. Add one when the previous stops
holding, not before:

1. **Honeypot + rate limit** (this release) — stops drive-by bots that scrape and post.
2. **Content heuristics** — link count, keyword blocklist, gibberish ratio. Needs real traffic to tune.
3. **CAPTCHA** (Turnstile) — the answer to *targeted* spam, where a headless browser renders the page
   and skips the hidden field like a human would. Its real cost is not server-side (~20 lines behind
   a `verify(token, secret)` interface) but that it requires a widget in the form, contradicting the
   template's promise that any existing HTML form works unchanged. Strictly opt-in per form.

## The notification email

- **Subject** — from `subjectTemplate`, `{{form}}` and `{{field}}` placeholders. Default
  `New submission: {{form}}`.
- **Body** — the submitted fields as label/value pairs, then submission metadata (time, IP, referer),
  then the file list with signed links, then a link to the submission in the inbox.
- **Reply-To** — the submitter's address, chosen as: the first field whose schema type is `email`,
  else the first field whose value looks like an email, else unset. Deterministic and unit-testable.
- **From** — `FROM_EMAIL` / `FROM_NAME`, as in `email-newsletter`.
- Values are **escaped** wherever rendered. Submission content is untrusted and this email is read in
  the owner's mail client.

## Delivery, retries and failure

The `deliver` worker owns all retry logic; channels are adapters behind one interface.

- Success → `sent`.
- Transient (5xx, network) → stays `pending`, retried up to `MAX_SEND_ATTEMPTS`.
- Permanent (4xx) → `failed` immediately.
- Provider rate limit (429) → stays `pending` **without** burning an attempt, and trips a global
  cooldown so other sends back off.
- An hourly job re-enqueues still-`pending` rows via `enqueueFromQuery`.

The inbox gains `GET /admin/api/submissions/:id/deliveries` so an owner can see what happened, and
`POST /admin/api/deliveries/:id/retry` to re-drive one.

## Platform constraints that still apply

Carried from Plan 1, verified against `codehooks-js` 1.4.10. All three fail silently:

1. **`parseBody` must remain the first awaited call** in the submit handler. The platform consumes
   the request stream once a handler yields, so anything else first empties multipart bodies. The new
   rate-limit and honeypot checks must therefore run **after** parsing, not before it.
2. **`filestore.getReadStream()` has no `.pipe()`** — use `.on('data')/.on('end')`, and obtain the
   stream before setting headers. Applies to the new signed-link route.
3. **The platform shadows `/health`** — app routes on that path never run. The status endpoint is
   `/status`.

## Testing

- **Unit** (`node --test`, no build step) for every pure decision: which files fit the attachment
  budget, subject templating, `Reply-To` selection, signed-token round-trip including expiry and
  tampering, the honeypot verdict, and the rate-limit decision.
- **Provider tests** against a fake fetch, asserting the shape each provider sends — Mailgun's
  multipart parts and Brevo's base64 payload — without hitting the network.
- **Integration** over HTTP against a dev space: submit → email queued → delivery row `sent`; a
  honeypot submission stored as spam with no delivery row; rate limit returning 429; and a signed
  link downloading the file byte-identically while an expired token is refused.

## Risks

| Risk | Mitigation |
|---|---|
| Honeypot false positive loses a real submission | Stored as spam and visible in the inbox, never dropped |
| Signed links are a new public surface | One file per token, 7-day expiry, signature-verified, `attachment` + `nosniff` |
| Attachments hurt deliverability | Per-form `attachFiles` toggle; links always included so link-only remains useful |
| A provider outage loses notifications | Durable outbox with retries and an hourly redrive |
| Attachment size exceeds provider limits | Deterministic budget, oversized files named in the email with links |
| Rate limiting takes a form offline | Throttle-store failure allows the request, matching the login throttle |
