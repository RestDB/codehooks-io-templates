# Changelog

Notable changes to the Codehooks.io templates in this repository.

This file starts with the `form-backend` release. Earlier entries are reconstructed from git history
and record when each template first landed, not every change made to it since. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); dates are ISO 8601.

Each template carries its own `version` in its `package.json`.

## [Unreleased]

### Added

- **`form-backend`** — headless form backend. One endpoint per form (`POST /f/:formId`), works with no
  JavaScript on the page, and accepts JSON, urlencoded and multipart with file uploads. Optional typed
  field validation, a server-side domain allowlist, admin JWT auth with login throttling, a submission
  inbox API (search, status, star, notes), authenticated file download, and CSV export with formula
  injection neutralised. Ships a live example client in `form-backend/example/`.
  116 unit tests, no build step. ([#15](https://github.com/RestDB/codehooks-io-templates/pull/15))

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
