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

Not built yet: email/webhook/Slack notifications, spam scoring, AI triage, and a visual admin UI.
The inbox is an API today.

## Quick start

```bash
coho create myforms --template form-backend
cd myforms && npm install

coho set-env JWT_SECRET "$(openssl rand -hex 32)" --encrypted
coho set-env ADMIN_PASSWORD 'choose-a-strong-password' --encrypted

coho deploy
coho info          # note your endpoint URL
```

## Verify your deployment

This doubles as the acceptance test. Set `U` to your deploy URL and `PW` to your `ADMIN_PASSWORD`.

```bash
U=https://your-space.codehooks.io
PW=choose-a-strong-password
```

**1. It is alive**

```bash
curl -s $U/health
# {"ok":true,"service":"form-backend"}
```

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
| `MAX_UPLOAD_MB` | no | Upload cap, default `5` |

Admin login is throttled to 8 attempts per IP per 15 minutes; a successful login clears the counter.

Per-form settings, via `PATCH /admin/api/forms/:id`:

| Field | Meaning |
|---|---|
| `name` | Display name |
| `enabled` | Set false to stop accepting submissions |
| `fields` | Field schema; `[]` accepts anything |
| `strict` | Reject fields not in the schema (ignored when `fields` is empty) |
| `allowedDomains` | Origin allowlist; `[]` allows any |
| `redirectUrl` | Where a browser post lands on success |
| `allowRedirectOverride` | Honour a `_redirect` field, still allowlist-checked |
| `retentionDays` | Reserved. **Not writable** — no purge job enforces it yet, so the field is deliberately locked rather than silently doing nothing |

Field types: `text`, `textarea`, `email`, `phone`, `url`, `number`, `date`, `rating`, `select`, `file`.

## Pointing a form at it

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

## Layout

```
index.ts              route registration only
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
test/                 116 unit tests, run with node --test, no build step
example/              the live demo client
```
