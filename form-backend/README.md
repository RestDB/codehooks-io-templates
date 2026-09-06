# Form Backend

A headless form backend on [Codehooks.io](https://codehooks.io). Point any HTML form at it and the
submissions land in your own database — with validation, file uploads, a domain allowlist, a
submission inbox API and CSV export.

No JavaScript is required on the page. It is the same job as Formspree, Getform or Basin, except you
host it and own the data.

**Live example:** [demo.formbackend.dev](https://demo.formbackend.dev) posts cross-origin to a real
deployment. Its source is in [`example/`](example/).

## Features

- **One endpoint per form** — `POST /f/:formId`, from an ordinary `<form action="...">`.
- **Three request shapes** — JSON, urlencoded, and multipart with file uploads. Binary files
  round-trip byte-identical.
- **Content-negotiated replies** — a JSON request gets `{"ok":true,"id":"..."}`; a browser form post
  gets a `302` to your `redirectUrl` or a hosted thank-you page.
- **Optional typed validation** — a form with no schema accepts anything, so an existing form works
  unchanged. Define fields and the server enforces types, `required`, `min`/`max` and `options`.
- **Domain allowlist** — checked server-side against `Origin`/`Referer` before anything is stored.
- **File uploads** — stored in the Codehooks filestore, served only to an authenticated admin.
- **Submission inbox API** — list, paginate, full-text search, filter by status and date, mark
  read/archived, star, add notes, delete (which also removes the files).
- **CSV export** — with spreadsheet formula injection neutralised.
- **Admin auth** — password login issuing an HttpOnly, Secure, SameSite=Strict JWT cookie.

- **Email notifications** — an owner gets emailed on submission, with the file attached (within a
  size budget) and a signed download link. Retried automatically on a transient provider failure.
- **A setup page** — `/setup/` walks a new customer from deploy to a working form: log in, create a
  form, copy a ready-to-paste snippet, and configure notifications and the domain allowlist. No curl
  required.

Not built yet: webhook/Slack notifications, spam scoring beyond the honeypot, and AI triage. The
inbox is an API today — the setup page is deliberately not a dashboard (see below).

## Quick start

```bash
coho create myforms --template form-backend
cd myforms && npm install

coho set-env JWT_SECRET "$(openssl rand -hex 32)" --encrypted
coho set-env ADMIN_PASSWORD 'choose-a-strong-password' --encrypted
coho set-env BASE_URL 'https://your-space.codehooks.io'   # required for notification emails

coho deploy
coho info          # note your endpoint URL
```

Then open `https://your-space.codehooks.io/setup/` in a browser and:

1. **Log in** with the `ADMIN_PASSWORD` you set above.
2. **Create a form** — give it a name.
3. **Copy the snippet** shown for that form and paste it into your site. It already points at the
   right endpoint and includes the honeypot field.
4. **Configure notifications** — turn on email, list recipient addresses, and optionally a subject
   template. This needs an email provider configured on the deployment (see
   [Configuration](#configuration)) — if a test submission doesn't produce an email, that is almost
   always a missing `FROM_EMAIL` or provider credential, not a bug in the form.
5. **Set the domain allowlist** if you want to restrict which sites can submit — the page explains
   the exact-match behaviour described below.

That is the whole setup. Submitting the pasted form is the same request `curl` would make below, so
everything after this point is optional — useful for automating deployment or for CI, not required
to get a form working.

## Verify your deployment

This doubles as the acceptance test for anyone automating setup instead of using `/setup/`. Set `U`
to your deploy URL and `PW` to your `ADMIN_PASSWORD`.

```bash
U=https://your-space.codehooks.io
PW=choose-a-strong-password
```

**1. It is alive**

```bash
curl -s $U/status
# {"ok":true,"service":"form-backend"}
```

The route is `/status`, not `/health`: the platform serves its own `/health` (it returns `Alive`)
and that shadows any route an app registers on the same path.

**2. Admin auth rejects and accepts correctly**

```bash
curl -s $U/admin/api/forms                     # 401, no data
curl -s -X POST $U/admin/login -H 'content-type: application/json' -d '{"password":"wrong"}'
# {"ok":false,"error":"Invalid password"}

curl -s -c /tmp/jar -X POST $U/admin/login \
  -H 'content-type: application/json' -d "{\"password\":\"$PW\"}"
# {"ok":true}
```

**3. Create a form and capture its uuid**

```bash
FORM=$(curl -s -b /tmp/jar -X POST $U/admin/api/forms \
  -H 'content-type: application/json' -d '{"name":"Contact"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["uuid"])')
echo $FORM
```

**4. All three request shapes are accepted**

```bash
# JSON  -> JSON reply
curl -s -X POST $U/f/$FORM -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com"}'

# urlencoded -> 302 redirect, as a browser would get
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  -X POST $U/f/$FORM -d 'name=Ada&email=ada@example.com'

# multipart with a file
printf 'hello' > /tmp/t.txt
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST $U/f/$FORM -F 'name=Ada' -F 'upload=@/tmp/t.txt'
```

**5. A checkbox group survives both encodings**

Repeated field names must produce the same stored value either way.

```bash
curl -s -o /dev/null -X POST $U/f/$FORM -d 'name=A&topics=x&topics=y&topics=z'
curl -s -o /dev/null -X POST $U/f/$FORM -F 'name=A' -F 'topics=x' -F 'topics=y' -F 'topics=z'
curl -s -b /tmp/jar "$U/admin/api/forms/$FORM/submissions?limit=2" \
  | python3 -c 'import sys,json; [print(r["data"].get("topics")) for r in json.load(sys.stdin)["data"]]'
# both lines: x, y, z
```

**6. The inbox works**

```bash
curl -s -b /tmp/jar "$U/admin/api/forms/$FORM/submissions?limit=5"
curl -s -b /tmp/jar "$U/admin/api/forms/$FORM/submissions?search=ada"
curl -s -b /tmp/jar "$U/admin/api/forms/$FORM/export.csv"
```

**7. Uploaded files download intact, and only for an admin**

```bash
IDS=$(curl -s -b /tmp/jar "$U/admin/api/forms/$FORM/submissions?limit=20" | python3 -c '
import sys,json
for r in json.load(sys.stdin)["data"]:
    if r.get("files"): print(r["_id"], r["files"][0]["id"]); break')
SUB=${IDS% *}; FID=${IDS#* }

curl -s -b /tmp/jar -o /tmp/dl.txt "$U/admin/api/submissions/$SUB/files/$FID"
diff /tmp/t.txt /tmp/dl.txt && echo "bytes identical"

curl -s -o /dev/null -w 'unauthenticated: %{http_code}\n' "$U/admin/api/submissions/$SUB/files/$FID"
# 401
```

**8. The domain allowlist is exact**

Lock the form down, then confirm near-miss hostnames are rejected — a suffix match would wrongly
allow `evil-example.com`.

```bash
ID=$(curl -s -b /tmp/jar $U/admin/api/forms | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["_id"])')
curl -s -b /tmp/jar -X PATCH $U/admin/api/forms/$ID \
  -H 'content-type: application/json' -d '{"allowedDomains":["example.com"]}' > /dev/null

for O in https://example.com https://evil-example.com https://notexample.com; do
  printf '%-28s %s\n' "$O" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST $U/f/$FORM -H "Origin: $O" \
       -H 'content-type: application/json' -d '{"name":"A"}')"
done
# example.com 200, the other two 403
```

**9. The unit suite**

```bash
npm test     # node --test test/*.test.ts
```

## Configuration

Environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | yes | Signs admin session cookies |
| `ADMIN_PASSWORD` | yes | Admin login password |
| `BASE_URL` | for notifications | Public URL of the deployment, e.g. `https://your-space.codehooks.io`. Used to build signed file-download links in notification emails; without it, notification delivery fails fast rather than sending a broken link |
| `EMAIL_PROVIDER` | no | `brevo` (default) or `mailgun` |
| `BREVO_API_KEY` | if using Brevo | Brevo API key |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` | if using Mailgun | Mailgun credentials. `MAILGUN_EU=true` selects the EU region |
| `FROM_EMAIL`, `FROM_NAME` | no | Sender address/name for notification emails |
| `MAX_UPLOAD_MB` | no | Upload cap, default `5` |
| `MAX_ATTACH_MB` | no | Total email attachment budget per notification |
| `SUBMIT_RATE_LIMIT` | no | Submissions per form per window before `429`, default `30` |

Admin login is throttled to 8 attempts per IP per 15 minutes; a successful login clears the counter.

Per-form settings — set from `/setup/`, or via `PATCH /admin/api/forms/:id` for automation:

| Field | Meaning |
|---|---|
| `name` | Display name |
| `enabled` | Set false to stop accepting submissions |
| `fields` | Field schema; `[]` accepts anything |
| `strict` | Reject fields not in the schema (ignored when `fields` is empty) |
| `allowedDomains` | Origin allowlist; `[]` allows any. Matching is **exact** — `example.com` does not also allow `www.example.com` |
| `redirectUrl` | Where a browser post lands on success |
| `allowRedirectOverride` | Honour a `_redirect` field, still allowlist-checked |
| `notify.email` | `{enabled, recipients, subjectTemplate, attachFiles}` — email notification settings |
| `retentionDays` | Reserved. **Not writable** — no purge job enforces it yet, so the field is deliberately locked rather than silently doing nothing |

Field types: `text`, `textarea`, `email`, `phone`, `url`, `number`, `date`, `rating`, `select`, `file`.

## Pointing a form at it

The setup page's snippet button does this for you, already filled in with your form's endpoint and
schema. Shown here as reference, and for automation that generates its own HTML:

```html
<form action="https://your-space.codehooks.io/f/YOUR_FORM_UUID" method="POST"
      enctype="multipart/form-data">
  <input name="name" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <input name="attachment" type="file">

  <!-- bots fill this in; people never see it -->
  <input name="_gotcha" style="display:none" tabindex="-1" autocomplete="off">

  <button>Send</button>
</form>
```

## Security notes

- The **domain allowlist is the real control**, not CORS. It runs server-side before anything is
  stored. CORS only governs whether a browser lets script read a response.
- The session cookie is `SameSite=Strict`, and that is **load-bearing**: the platform adds permissive
  CORS headers to every response, so relaxing this flag would let any site read the admin API with
  the admin's cookie.
- Uploads are attacker-supplied. They are served only to an authenticated admin, as
  `content-disposition: attachment` with `nosniff`, never through a public route.
- `_redirect` overrides are resolved against the allowlist, so `//evil.com` cannot escape.
- CSV exports neutralise leading `=`, `+`, `-` and `@` so a submitted value cannot execute as a
  spreadsheet formula.
- The setup page (`/setup/`) is a static file with no server-side session check of its own — it is
  safe to serve unauthenticated because every action on it calls `/admin/api/*`, which enforces the
  session cookie exactly as it does for a curl-driven client. Visiting it with no cookie shows the
  login form, not any account's data.

## Verified against

The three platform behaviours documented under **Security notes** and in the source comments are
version-dependent. This template was built and verified against:

| | Version |
|---|---|
| `codehooks-js` | 1.4.10 |
| `coho` CLI | 1.3.3 |
| Node.js | 23.7 (type stripping, so tests run on `.ts` with no build step) |
| `jsonwebtoken` | 9.0.3 |

Dependencies are declared as `latest` so a new project picks up current releases. If a future
`codehooks-js` changes how the request stream is consumed or how `filestore.getReadStream()` behaves,
re-check the two workarounds in `index.ts` — they exist because of platform behaviour, not preference.

## Layout

```
index.ts              route registration only
public/index.html     the setup page, served at /setup/ — no build step, no dependencies
lib/multipart.ts      raw request bytes -> fields + files
lib/body.ts           content-type dispatch
lib/validation.ts     field schema enforcement
lib/security.ts       redirect, CORS and filename safety
lib/forms.ts          forms collection
lib/auth.ts           admin JWT
lib/files.ts          filestore persistence
lib/search.ts         inbox filter + pagination
lib/csv.ts            CSV export
lib/throttle.ts       admin login attempt limiting
lib/pages.ts          hosted thank-you and error pages
lib/snippet.ts        generates the paste-into-your-site HTML shown on the setup page
lib/notify.ts         notification email composition
lib/delivery.ts       delivery retry classification
lib/channels/         notification channel adapters (email)
lib/providers/        email provider adapters (Brevo, Mailgun)
lib/attachments.ts    attachment size budgeting
lib/signed-links.ts   token-scoped file download links for emails
test/                 200 unit tests, run with node --test, no build step
example/              the live demo client
```
