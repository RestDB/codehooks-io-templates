# Stripe Webhook Handler

A TypeScript webhook handler for Stripe events using Codehooks.io.

## Features

- Verifies Stripe webhook signatures for security
- Logs all events to console
- Stores events in a `stripe_events` collection
- Includes health check endpoint

## Quick Setup

### Option 1: Create a new project with this template (Recommended)

```bash
coho create my-stripe-handler --template stripe-webhook-handler
cd my-stripe-handler
npm install
```

### Option 2: Install in an existing directory

```bash
mkdir my-stripe-handler
cd my-stripe-handler
coho install stripe-webhook-handler
npm install
```

## Deploy

```bash
coho deploy
```

## Setup

1. **Configure environment variables** using one of these methods:

   **Option A: Via Codehooks Studio**
   - Go to your project in Codehooks Studio
   - Navigate to Settings → Environment Variables
   - Add: `STRIPE_SECRET_KEY` with value `sk_test_...`
   - Add: `STRIPE_WEBHOOK_SECRET` with value `whsec_...`

   **Option B: Via CLI**
   ```bash
   coho set-env STRIPE_SECRET_KEY "sk_test_..."
   coho set-env STRIPE_WEBHOOK_SECRET "whsec_..."
   ```

2. **Configure Stripe webhook**:
   - Go to https://dashboard.stripe.com/webhooks
   - Add endpoint with your deployed URL: `https://YOUR_PROJECT.api.codehooks.io/dev/webhook`
   - Select the events you want to receive
   - Copy the webhook signing secret to your environment variables

## Endpoints

- `POST /webhook` - Stripe webhook endpoint
- `GET /` - Health check

## Event Storage

Events are stored in the `stripe_events` collection with the following structure:
```json
{
  "event_id": "evt_...",
  "type": "payment_intent.succeeded",
  "created": 1234567890,
  "livemode": false,
  "data": { ... },
  "api_version": "2024-11-20.acacia",
  "request": { ... },
  "received_at": "2024-01-01T00:00:00.000Z"
}
```

## Testing

Use the Stripe CLI to test webhooks locally:
```bash
stripe listen --forward-to https://your-project.api.codehooks.io/dev/webhook
stripe trigger payment_intent.succeeded
```
