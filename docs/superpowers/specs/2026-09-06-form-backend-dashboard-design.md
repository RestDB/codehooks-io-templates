# form-backend — admin dashboard

**Date:** 2026-09-06
**Status:** design, approved, ready for implementation planning
**Builds on:** `2026-09-02-form-backend-design.md` (capture core) and
`2026-09-06-form-backend-email-notifications-design.md` (notifications)

The template can capture submissions and email them. It cannot **show** them. `public/index.html`
is a settings page — create a form, configure notifications, copy a snippet, delete a form — and
every question about the data itself ("what did that person actually write?", "did the CV come
through?", "how many applications this week?") still requires curl or a database query.

This release turns that settings page into an inbox, with settings kept as one section of it.

## Goals

- Read submissions: a list, a record, and the files attached to it.
- Triage them: search, filter by status and date, star, mark read, archive, flag spam, delete, note.
- Keep everything the setup page already does, unchanged in capability.
- Look considered rather than generic, without adding a build step or a network dependency.

## Non-goals

Each is cheap to add later on the structure this release introduces, and each would enlarge the
review surface now:

- **Webhooks.** They get a panel in Settings when they exist; the tab is already the right home.
- **Bulk selection and bulk actions.** Needs a selection model and an undo story of its own.
- **Saved views, dark mode, a field-schema editor** beyond today's capability.
- **Reply-from-the-dashboard.** Sending mail to untrusted addresses is its own design, as noted in
  the notifications spec's autoresponder non-goal. The mockup shows a Reply control; it ships as a
  `mailto:` link, not as a sending feature.

## The approach

**Tailwind via the play CDN, DM Sans, and our own components — no build step.**

An earlier revision of this spec argued the opposite: self-contained CSS, no CDN, no webfont, on
the grounds that a self-hosted form backend may run offline or behind a strict proxy. That version
was built and reviewed on screen, and it was not good enough — the type was flat, spacing was
inconsistent, controls the design system never covered (date fields) fell back to raw browser
chrome, and empty panes read as broken. The operator compared it against the sibling
`email-newsletter` admin and chose that approach instead. This section records what we actually
build, so the document stops describing a page that no longer exists.

Three external requests: `cdn.tailwindcss.com`, and DM Sans from `fonts.googleapis.com` /
`fonts.gstatic.com`. **The consequence, stated plainly:** the admin UI needs network access to
render correctly. Offline or behind a proxy that blocks those hosts, `/setup/` renders unstyled.
Nothing else is affected — the submit endpoint, the whole `/admin/api/*` surface and every stored
submission are untouched, because none of them are served by this page.

**No build step, and that constraint is not negotiable.** `public/` is served directly by
`app.static`, so the template stays forkable and `coho deploy`-able with nothing installed. This is
why shadcn/ui was considered and rejected: it is React source built on Radix, so adopting it means
React, JSX and a bundler, and `public/` becomes build output that a customer must rebuild to change
a colour. Its interaction model is worth copying; its packaging is not.

### Components, not utility soup

The reference template styles 56 buttons with roughly 40 distinct Tailwind utility strings. That is
the thing its own CLAUDE.md calls a maintenance hazard, and copying it would be a downgrade — the
version of this dashboard it replaced had 41 semantic classes and four button variants.

So: Tailwind's scale and palette, but the repeated pieces live in `@layer components` inside a
`<style type="text/tailwindcss">` block — `.btn`, `.btn-primary`, `.btn-danger`, `.btn-quiet`,
`.field`, `.label`, `.chip`, `.eyebrow`. View modules emit semantic class names; a change of mind is
one edit rather than forty.

**No native form controls.** `<select>`, `<dialog>` and `<input type="date">` each impose browser
chrome that no amount of CSS brings fully into the palette, and they look pasted in from another
application. In their place, built in `ui.js` and shared by every view:

| Component | Replaces | Notes |
|---|---|---|
| `dropdown(input, options)` | `<select>` | `role="listbox"`, arrow-key roving focus, Escape and click-outside to close. The value lives in a hidden `<input>` carrying the public id and dispatching `change`, so consumers still read `.value` and listen for `change` |
| `openModal({...})` | `<dialog>`, `window.prompt` | overlay with backdrop blur, focus moved to the first field |
| `confirmInline` | `window.confirm` | two-step in place, for destructive actions |
| `toast(message, kind)` | `alert` | bottom-right, auto-dismissing |
| `emptyState(title, hint)` | — | icon, title and a next step, so an empty pane reads as waiting rather than broken |

Icons are inline SVG paths in the sibling template's idiom — `fill="none" stroke="currentColor"
stroke-width="2" viewBox="0 0 24 24"` — with no icon library. The product mark is the form icon from
the codehooks.io site (`static/img/webhooks/form-icon.svg`), recoloured via `currentColor`.

## Information architecture

Three panes on desktop, the shape of an inbox because that is what this is:

```
┌───────────┬─────────────────────┬───────────────────────┐
│  FORMS    │  SUBMISSIONS        │  RECORD               │
│  216px    │  336px              │  fluid                │
│  + counts │  + search, filters  │  fields, files, meta  │
└───────────┴─────────────────────┴───────────────────────┘
```

- **Rail** — every form, each with an unread count; a "New form" button.
- **Tabs above the list** — `Submissions` | `Settings`. Settings is today's setup UI moved across
  intact: notifications, allowed domains, snippet, delete form. (There is no fields editor — the
  old page never had one, and this UI does not add one; `fields` stays PATCH-only.)
- **List** — one row per submission: who it is from, a content snippet, relative time, marks for
  starred and attachments. Search box, status filter, date range, and a footer showing the range and
  total with pagination.
- **Record** — the submission itself, its files, its metadata, and its notes, with the actions.

Below the `lg` breakpoint (1024px) the rail collapses to the `dropdown()` listbox (see below, not a
native `<select>`) in the header, and the list and record stack.

**The URL stays `/setup/`.** `/admin/` would collide with the `/admin/api/*` routes, and the README,
the generated snippet, the landing page and the docs all already point at `/setup/`.

## Visual direction

The current page is cool slate with `#2563eb` — the default admin look. Three deliberate moves
replace it.

**Warm neutral ground; colour reserved for meaning.**

| Token | Value | Role |
|---|---|---|
| `--paper` | `#FBFAF7` | page ground |
| `--surface` | `#FFFFFF` | panes |
| `--sunk` | `#F4F2EE` | rail, inset areas |
| `--ink` | `#1C1917` | headings |
| `--body` | `#44403C` | prose |
| `--muted` | `#A8A29E` | metadata |
| `--rule` | `#E7E5E4` | hairlines |
| `--accent` | `#0F5C5C` | primary actions, focus ring, the `new` edge |
| `--flag` | `#B91C1C` | spam only |
| `--star` | `#B45309` | starred only |

Deep teal rather than notification-blue: this is an archive of correspondence received from
strangers, and the accent should read as archival ink rather than as an alert. Status rides a **3px
left edge on a list row**, never a badge — `new` takes the accent edge and a heavier name, `read`
takes neither, `archived` recedes into muted text, `spam` takes the red edge and muted text. Two
colours in the list, total.

**Two type roles.**

```
sans: "DM Sans", system-ui, sans-serif          — everything a person reads
mono: ui-monospace, SFMono-Regular, "SF Mono",  — everything that is data
      Menlo, monospace
```

DM Sans is loaded from Google Fonts, matching the sibling template; the monospace role stays a
system stack, because a second webfont would buy nothing. Every stack names real fallbacks, so a
blocked font degrades to a system face rather than to nothing.

The monospace face carries field keys, timestamps, IP addresses, file sizes, IDs and the endpoint
snippet — the things that are literally data — with `tabular-nums` wherever digits align. That
contrast is the character of the page.

**The record is the signature element.** Field keys set small in the monospace face, right-aligned
in a 7.25rem column; values in the text face across a hairline grid. It reads as the payload it
actually is, but set like a printed form. Everything around it stays quiet.

Light theme only in v1.

## Backend additions

The inbox API is otherwise complete. Three gaps this UI exposes, all in `index.ts`:

**There is no filtered count operation.** The documented Datastore API is `insertOne`, `findOne`,
`findOneOrNull`, `getMany`/`find`, `updateOne`, `updateMany`, `replaceOne`, `replaceMany`,
`removeOne`, `removeMany`. The `count(collection)` in the type definitions takes no query, so it
cannot answer "how many submissions on this form have status `new`". Counting means scanning.

Both counts therefore use a **bounded scan with field projection**, the same shape `lib/search.ts`
already uses for its scan cap:

```ts
const rows = await conn
  .getMany(collection, query, { hints: { $fields: { _id: 1 } }, limit: COUNT_CAP + 1 })
  .toArray();
const exact = rows.length <= COUNT_CAP;
const count = exact ? rows.length : COUNT_CAP;
```

Projecting to `_id` keeps the payload small; the extra row distinguishes "exactly `COUNT_CAP`" from
"more than that". `COUNT_CAP` is 5000. Beyond it the UI shows `5000+` rather than a wrong number —
an honest ceiling, not a lie, and consistent with how search already reports `truncated`.

1. **`GET /admin/api/forms/:formId/submissions` returns `total` only on the search path.** Without
   it the list cannot render "1-50 of 214" or know when paging ends. Return `total` and `exact` on
   the non-search path too, counted as above against the same filter.

2. **Nothing supplies the rail's unread count.** Add `newCount` to each form in
   `GET /admin/api/forms`, counted as above over `{ formId: uuid, status: 'new' }`. This is one
   scan per form; the forms list is small by nature, and `newCount` is capped at 999 for display.

3. **`forms.stats.total` is a lifetime-received counter, not a live count.** An earlier draft of
   this spec said it "drifts upward" because nothing decrements it on delete. That was wrong on the
   facts: it never incremented at all. This datastore does not treat dot notation as a path, so
   `$inc: { 'stats.total': 1 }` had been writing a top-level field literally *named* `stats.total`
   while the nested value the API returned stayed at zero — silently, since the release. It is fixed
   (flat atomic counters composed back into `stats` on read; see `lib/stats.ts`) and now reports
   correctly.

   It still answers a different question from the one the dashboard asks. `stats.total` is how many
   submissions the form has ever received; the rail badge and the list footer need how many are
   stored right now. **Every displayed count comes from the scans above.** The dashboard may show
   `stats.total` where it genuinely means "received all time", and must not write it.

No other route changes. Everything else the dashboard needs already exists.

The projection syntax (`hints: { $fields: ... }`) is documented but unverified on this deployment.
The first backend task verifies it live before the counts are built on it - the same
prove-it-on-the-platform discipline that caught the multipart, stream and `/health` surprises.

## File structure

```
form-backend/public/
  index.html      shell markup, tailwind config, and the @layer components block
  app.js          entry: boot, auth gate, view routing
  api.js          one function per endpoint; the only place fetch appears
  ui.js           el(), dropdown, modal, toast, confirm, empty states
  submissions.js  list pane and record pane
  settings.js     the current setup UI, ported
  format.js       pure display logic — no DOM, no fetch
```

There is no `app.css`: the token system lives in the `tailwind.config` block and the component
classes in `@layer components`, both in `index.html`, which is where the play CDN needs them.

`format.js` exists so the display decisions are testable: `node --test` can import it directly, the
way `lib/*` modules already are. Everything in it is a pure function.

Six focused modules rather than one long page, for the same reason the design of `lib/` is what it
is: a file that fits in one reading is one that can be changed safely.

## Security

Nothing here loosens the existing posture, and two things need saying explicitly:

- **Submission content is attacker-controlled and is rendered in this page.** Every dynamic
  insertion uses `textContent` or `createTextNode`. `innerHTML` does not appear in the new modules
  except for static literals already present in the page. This is the same rule the current setup
  page follows and the reason it survived review.
- **Uploaded filenames are attacker-controlled** and are rendered in the file list. They are text
  nodes, and the existing download route already serves them with `content-disposition: attachment`
  and `x-content-type-options: nosniff`.
- The session cookie's `SameSite=Strict` remains the only protection against cross-origin admin
  requests, because the platform injects permissive CORS headers on every response. Nothing in this
  release may add a route that bypasses the `/admin/api/*` auth.

## Testing

- **Unit** (`node --test`, joining the existing 200) over `format.js`: relative time across
  boundaries, the summary line chosen from a submission's fields, filter query-string building,
  byte-size formatting, and which actions are offered for each status.
- **Backend** unit coverage for the three route additions where the logic is extractable.
- **Browser walkthrough** of the panes against a live deploy: select a form, read a record,
  download a file, search, filter, star, archive, add a note, delete, and every Settings control
  that exists today — confirming nothing regressed in the port.
- Verify in the browser that the network allowlist beyond `/setup/` and `/admin/api/*` is exactly
  the three hosts named in Approach above (`cdn.tailwindcss.com`, `fonts.googleapis.com`,
  `fonts.gstatic.com`) — nothing else — and that the page still loads, signs in, lists submissions
  and opens a record with those three blocked, unstyled but functional.

## Risks

| Risk | Mitigation |
|---|---|
| The Settings port silently loses a control that works today | The walkthrough enumerates every existing control; the port is one task, reviewed against the current file |
| ES modules fail to load on the platform | Verified before design: `.js` serves as `application/javascript`; `.mjs` 404s, so no file uses it |
| Counts shown are wrong | Counts come from count queries, never from the drifting `stats.total` |
| Untrusted content escapes into the DOM | `textContent` only; a review gate on any `innerHTML` |
| Three panes are unusable on a phone | Rail collapses to a select and panes stack below 1040px |
| The page grows into another 2,000-line file | Eight files, each with one responsibility, split at design time rather than after |
