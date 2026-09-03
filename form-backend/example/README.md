# Example client

A working form that posts to the `form-backend` API **from a different origin**, so it
exercises the parts of the backend that only misbehave in a real browser: the domain
allowlist, the CORS preflight, multipart uploads, and repeated field names.

It is also the documentation. The page shows the request it is about to make and the
response it got back, and the disclosure at the bottom carries the plain HTML form —
no JavaScript — that does the same thing.

## Point it at your backend

Two lines, at the bottom of [`public/index.html`](public/index.html):

```js
const API     = 'https://api.formbackend.dev';
const FORM_ID = 'your-form-uuid';
```

`FORM_ID` is the form's `uuid` (not its `_id`), which you get from
`POST /admin/api/forms` or from the forms list.

## Run it

Serve `public/` with anything — it is a single static file with no build step:

```bash
npx serve public
```

## Deploy it to its own space

Deploying the client somewhere the backend is **not** is the point: same-origin requests
would never exercise the allowlist.

```bash
coho add --space client --projectname <your-project>
# link this directory to that space
cat > config.json <<'JSON'
{ "name": "<your-project>", "space": "client" }
JSON
npm install && coho deploy
```

Then add the client's hostname to the form's allowlist, or submissions will be rejected:

```bash
curl -b cookies -X PATCH "$API/admin/api/forms/<form _id>" \
  -H 'content-type: application/json' \
  -d '{"allowedDomains": ["demo.example.com"]}'
```

An empty `allowedDomains` accepts any origin, which is the right default for a public
contact form and the wrong one as soon as you care where submissions come from.

## What the allowlist actually does

It is checked **server-side**, against the `Origin` (or `Referer`) header, before anything
is stored. That check is the real control — not CORS, which only governs whether a browser
lets script *read* the response.

Matching is exact, on the full hostname. Verified against this deployment:

| Origin | Result |
|---|---|
| `demo.formbackend.dev` (on the list) | `200` |
| `evil.example` | `403 Origin not allowed` |
| `evil-formbackend.dev` | `403` — a suffix match would have let this through |
| `notdemo.formbackend.dev` | `403` — subdomains are not implied |

## Two response styles

The backend decides from the request's content type:

- `content-type: application/json` → a JSON reply, `{"ok":true,"id":"…"}`.
- A normal form post → `302` to the form's `redirectUrl`, or to the hosted thank-you page.

This page sends JSON when there is no file attached, and multipart when there is — so it
shows you both.
