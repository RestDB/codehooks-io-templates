# Stripe Webhook Handler (Minimal)

A minimal Stripe webhook handler for Codehooks.io that receives and processes Stripe events.

## Features

- ✅ Secure signature verification
- ✅ Handles common payment events
- ✅ Minimal code (~60 lines)
- ✅ Production-ready

## Setup

### 1. Deploy to Codehooks.io

```bash
coho create myapp --template webhook-stripe-minimal
cd myapp
npm install
coho deploy
```

### 2. Set Environment Variables

Set your environment variables using one of these methods:

**Option A: Via Codehooks Studio**
1. Go to your project in Codehooks Studio
2. Navigate to Settings → Environment Variables
3. Add: `STRIPE_SECRET_KEY` with value `sk_test_...`
4. Add: `STRIPE_WEBHOOK_SECRET` with value `whsec_...`

**Option B: Via CLI**
```bash
coho set-env STRIPE_SECRET_KEY sk_test_...
coho set-env STRIPE_WEBHOOK_SECRET whsec_...
```

Get your secret key from: https://dashboard.stripe.com/test/apikeys

### 3. Configure Stripe Webhook

1. Go to [Stripe Webhooks Dashboard](https://dashboard.stripe.com/test/webhooks)
2. Click "Add endpoint"
3. Set **Endpoint URL** to: `https://your-project.api.codehooks.io/dev/webhook`
4. Select events to listen to (or choose "Select all events")
5. Click "Add endpoint"
6. Copy the **Signing secret** (starts with `whsec_`) and set it as `STRIPE_WEBHOOK_SECRET`

## Supported Events

This handler processes:

- **payment_intent.succeeded** - Successful payment
- **payment_intent.payment_failed** - Failed payment
- **customer.created** - New customer
- **customer.subscription.created** - New subscription
- **customer.subscription.deleted** - Canceled subscription

## Testing

Use Stripe CLI to test locally:

```bash
stripe listen --forward-to https://your-project.api.codehooks.io/dev/webhook
stripe trigger payment_intent.succeeded
```

Or check logs after real events:

```bash
coho logs --tail 50
```

## Customization

Add your own event handlers:

```javascript
case 'invoice.payment_succeeded':
  console.log('Invoice paid:', event.data.object.id);
  // Send receipt email, update database, etc.
  break;
```

## Security

- Always verify signatures in production
- Never expose your `STRIPE_SECRET_KEY`
- Use test keys during development

## Resources

- [Stripe Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Stripe Events Reference](https://stripe.com/docs/api/events/types)
- [Codehooks.io Documentation](https://codehooks.io/docs)
