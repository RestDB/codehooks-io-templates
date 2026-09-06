# form-backend — carried forward

Decisions and known gaps from Plan 1 (capture core) that later plans need. Written down because the
working ledger they came from is scratch and gets deleted.

**Spec:** `docs/superpowers/specs/2026-09-02-form-backend-design.md`
**Plan 1:** `docs/superpowers/plans/2026-09-03-form-backend-capture-core.md` — complete, merged via PR #15.

Plans 2–4 are deliberately unwritten. Each is written after the previous one lands, so it can be
informed by what implementation actually taught us.

| Plan | Scope |
|---|---|
| 2 | Admin UI (the inbox is an API today) |
| 3 | Delivery & spam — outbox channels, spam layers, jobs |
| 4 | AI triage & docs |

## Do this first in Plan 3

**Build the outgoing webhook channel before email notifications**, reversing the order the spec lists.
The webhook channel changes what the product *is* rather than adding a convenience: it turns
form-backend from "collects submissions" into "turns any HTML form into a signed webhook to your own
systems". That fills a genuine gap in the codehooks.io homepage story, which currently covers
receiving webhooks, sending them, and inspecting them — but not *originating* one from something that
isn't already a webhook.

Only after it ships should the homepage gain a form-backend card, and only then may copy say "signed
webhook" — that is a promise about behaviour.

## Platform behaviours that constrain any future work

Each is documented at the line that depends on it. All three were discovered by deploying, not by
reading docs, and all three fail silently.

1. **The request stream is consumed once a handler yields at any `await`.** `parseBody` must be the
   first awaited call in any handler that reads a body, or multipart arrives empty. Measured: 0/3
   multipart submissions survived the wrong ordering, 20/20 after the fix.
2. **`filestore.getReadStream()` resolves to a stream with no `.pipe()`.** Use
   `.on('data', buf => res.write(buf, 'buffer')).on('end', …)`, matching the SDK's own `app.static`.
   Obtain the stream *before* setting headers, or a failure surfaces as HTTP 200 with an error body.
3. **The platform injects `Access-Control-Allow-Origin: <echoed origin>` plus
   `Access-Control-Allow-Credentials: true` on every response**, including for routes that do not
   exist. Our CORS headers cannot override it, so the session cookie's `SameSite=Strict` is the only
   thing protecting the admin API. **Never relax it.**

Verified against `codehooks-js` 1.4.10 / `coho` 1.3.3. Re-check 1 and 2 if those change.

## Fields that exist but are not enforced

Written to documents so a later plan needs no data migration. Two are deliberately **not** writable
via `PATCH /admin/api/forms/:id`, because a knob that silently does nothing is worse than no knob:

| Field | State | Owner |
|---|---|---|
| `honeypot` | on the form, not writable, not enforced | Plan 3 |
| `retentionDays` | on the form, not writable, no purge job | **unassigned — decide who owns it** |
| `spam.score` / `spam.reasons` | on submissions, written as defaults, never read | Plan 3 |
| `ai` | on submissions, written as `null`, never read | Plan 4 |

When Plan 3 enforces the honeypot, derive the strip-list and the strict-mode exemption from
`form.honeypot` rather than the hardcoded `_gotcha` in `index.ts` and `lib/validation.ts`.

## Known gaps, with reasons they were deferred

- **CSV export reads the collection unbounded** (`index.ts`), unlike every other read path, which is
  capped. Capping changes export semantics (partial exports), so it wants a deliberate decision rather
  than a reflex. Consider streaming rows with `res.write` per line — the file-download route already
  shows the pattern.
- **404 / 405 / 500 return JSON to browser form posts**, while 400 / 403 / 413 return an HTML page via
  `fail()`. Cosmetic today because those statuses are setup-time developer errors, but worth unifying
  when the admin UI lands.
- **`PATCH`/`DELETE /admin/api/forms/:id` accept `_id` only**, while the submissions and export routes
  accept either identifier via `resolveForm`. Left asymmetric on purpose: widening a destructive route
  for a consistency nit is a poor trade. Plan 2 knows which identifier its UI holds — decide there.
- **The API decides JSON-vs-redirect from the request content-type, not the `Accept` header.** A fetch
  client sending multipart therefore cannot request a JSON reply. Standard form backends honour
  `Accept`; worth adding in Plan 2 when the UI exercises it.
- **No MIME allowlist on uploads** (the spec calls for one). Safe today because downloads are
  `content-disposition: attachment` with `nosniff`. It becomes load-bearing the moment the admin UI
  adds inline image preview — do it *before* that, not after.
- Minor: `notes` can grow unbounded; `content-disposition` lacks RFC 5987 encoding for non-ASCII
  filenames; `tsconfig` does not set `strict`; the `next < 0` branch in `lib/multipart.ts` is untested.

## Documentation owed

- The README should explain how `/admin/api/*` is protected and what provisioning a space API token
  would mean for admin access. This could not be tested during Plan 1 — the dev space had no API
  tokens provisioned, so the API-key-vs-JWT interaction is unverified.
