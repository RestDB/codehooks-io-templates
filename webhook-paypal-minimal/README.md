# PayPal Webhook Handler (Minimal)

A minimal PayPal webhook handler for Codehooks.io that receives and processes PayPal payment events.

## Features

- Secure signature verification via PayPal API
- Validates all required PayPal headers
- Access token caching for efficiency
- Handles common payment and subscription events
- Supports sandbox and live modes
- Minimal code (~180 lines)
- Production-ready

## Setup

### 1. Deploy to Codehooks.io

```bash
coho create myapp --template webhook-paypal-minimal
cd myapp
npm install
coho deploy
```

### 2. Get PayPal API Credentials

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox)
2. Click "Create App" or select an existing app
3. Copy your **Client ID** and **Secret**

### 3. Set Environment Variables

Set your environment variables using one of these methods:

**Option A: Via Codehooks Studio**
1. Go to your project in Codehooks Studio
2. Navigate to Settings > Environment Variables
3. Add the following variables:
   - `PAYPAL_CLIENT_ID` - Your PayPal app Client ID
   - `PAYPAL_CLIENT_SECRET` - Your PayPal app Secret
   - `PAYPAL_WEBHOOK_ID` - Your webhook ID (from step 4)
   - `PAYPAL_MODE` - Set to `sandbox` for testing or `live` for production

**Option B: Via CLI**
```bash
coho set-env PAYPAL_CLIENT_ID AYour-Client-ID
coho set-env PAYPAL_CLIENT_SECRET EYour-Client-Secret
coho set-env PAYPAL_WEBHOOK_ID 1AB23456CD789012E
coho set-env PAYPAL_MODE sandbox
```

### 4. Configure PayPal Webhook

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox)
2. Select your app
3. Scroll down to **Webhooks** and click "Add Webhook"
4. Set **Webhook URL** to: `https://your-project.api.codehooks.io/dev/webhook`
5. Select the events you want to receive:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.DENIED`
   - `CHECKOUT.ORDER.APPROVED`
   - `CHECKOUT.ORDER.COMPLETED`
   - `BILLING.SUBSCRIPTION.CREATED`
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - Or select all events
6. Click "Save"
7. Copy the **Webhook ID** and set it as `PAYPAL_WEBHOOK_ID`

## Supported Events

This handler processes:

- **PAYMENT.CAPTURE.COMPLETED** - Payment successfully captured
- **PAYMENT.CAPTURE.DENIED** - Payment capture denied
- **CHECKOUT.ORDER.APPROVED** - Customer approved the order
- **CHECKOUT.ORDER.COMPLETED** - Order completed successfully
- **BILLING.SUBSCRIPTION.CREATED** - New subscription created
- **BILLING.SUBSCRIPTION.ACTIVATED** - Subscription activated
- **BILLING.SUBSCRIPTION.CANCELLED** - Subscription cancelled
- **PAYMENT.SALE.COMPLETED** - Sale completed (legacy)

## Testing

### Using PayPal Webhook Simulator

1. Go to [PayPal Webhook Simulator](https://developer.paypal.com/dashboard/webhooksSimulator)
2. Select your webhook
3. Choose an event type to simulate
4. Click "Send Test"

### Check Logs

```bash
coho logs --tail 50
```

## Customization

Add your own event handlers:

```javascript
case 'INVOICING.INVOICE.PAID':
  console.log('Invoice paid:', resource.id);
  // Send confirmation email, update database, etc.
  break;
```

## Switching to Production

1. Set `PAYPAL_MODE` to `live`
2. Use your live app credentials (not sandbox)
3. Create a webhook in your live app settings
4. Update `PAYPAL_WEBHOOK_ID` with the live webhook ID

```bash
coho set-env PAYPAL_MODE live
coho set-env PAYPAL_CLIENT_ID your-live-client-id
coho set-env PAYPAL_CLIENT_SECRET your-live-client-secret
coho set-env PAYPAL_WEBHOOK_ID your-live-webhook-id
```

## Security

- Webhook signatures are verified via PayPal's API
- All required PayPal headers are validated before processing
- Never expose your `PAYPAL_CLIENT_SECRET`
- Use sandbox credentials during development
- The `PAYPAL_WEBHOOK_ID` must match the webhook configured in PayPal

## Production Considerations

For high-traffic production use, consider these enhancements:

**Idempotency** - PayPal may retry webhooks. Store processed `event.id` values to avoid duplicate processing:

```javascript
const conn = await Datastore.open();
const existing = await conn.getOne('processed_events', { event_id: eventId });
if (existing) {
  return res.status(200).json({ received: true, duplicate: true });
}
await conn.insertOne('processed_events', { event_id: eventId, processed_at: new Date() });
```

**Quick Response** - The handler responds immediately after verification. For slow processing, use a queue:

```javascript
// Acknowledge immediately, process async
res.status(200).json({ received: true });
await conn.insertOne('webhook_queue', { event: body, received_at: new Date() });
```

**Event Types** - This template handles REST API v2 events (`PAYMENT.CAPTURE.*`, `CHECKOUT.ORDER.*`) and legacy Classic API events (`PAYMENT.SALE.*`). The resource shapes differ between these APIs.

## Resources

- [PayPal Webhooks Documentation](https://developer.paypal.com/docs/api-basics/notifications/webhooks/)
- [PayPal Webhook Events Reference](https://developer.paypal.com/docs/api-basics/notifications/webhooks/event-names/)
- [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/)
- [Codehooks.io Documentation](https://codehooks.io/docs)
