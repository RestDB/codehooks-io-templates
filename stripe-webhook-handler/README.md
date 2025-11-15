# Stripe Webhook Handler

A TypeScript webhook handler for Stripe events using Codehooks.io.

## Features

- Verifies Stripe webhook signatures for security
- Logs all events to console
- Stores events in a `stripe_events` collection
- Includes health check endpoint

## Connect to a project

Create or use an existing project folder for the code.

```bash
mkdir my-stripe-handler
cd my-stripe-handler
coho init --empty
```

## Install the template with the CLI

```bash
coho install 'stripe-webhook-handler'
npm install
```

Verify that all the files are downloaded ok, then run the deploy command next.

## Deploy

```bash
coho deploy
```

## Setup

1. **Configure environment variables** in your Codehooks project:
   ```bash
   coho env set STRIPE_SECRET_KEY "sk_test_..."
   coho env set STRIPE_WEBHOOK_SECRET "whsec_..."
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
