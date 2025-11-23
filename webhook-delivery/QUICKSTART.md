# Quick Start Guide

Get your outgoing webhook system up and running in 5 minutes.

## Step 1: Deploy (30 seconds)

```bash
coho create my-webhook-system --template webhook-delivery
cd my-webhook-system
npm install
coho deploy
```

Note your deployment URL (e.g., `https://my-webhook-system-abc123.api.codehooks.io/dev`)

## Step 2: Test with webhook.site (2 minutes)

### Register a webhook

1. Go to [webhook.site](https://webhook.site)
2. Copy your unique URL
3. Register it:

```bash
curl -X POST https://YOUR-APP.api.codehooks.io/dev/webhooks \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{
    "clientId": "test-client-1",
    "url": "https://webhook.site/YOUR-UNIQUE-ID",
    "events": ["*"]
  }'
```

4. Save the `id` and `secret` from the response

### Trigger an event

```bash
curl -X POST https://YOUR-APP.api.codehooks.io/dev/events/trigger/user.created \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{
    "userId": "user_123",
    "email": "test@example.com",
    "name": "John Doe"
  }'
```

5. Check webhook.site - you should see the webhook delivery!

## Step 3: Test Locally (2 minutes)

### Start test receiver

```bash
# Terminal 1
node test-receiver.js
```

### Expose with ngrok

```bash
# Terminal 2
ngrok http 3000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)

### Register the webhook

```bash
# Terminal 3
curl -X POST https://YOUR-APP.api.codehooks.io/dev/webhooks \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{
    "clientId": "test-client-2",
    "url": "https://YOUR-NGROK-ID.ngrok.io/webhook",
    "events": ["*"]
  }'
```

Copy the `secret` from the response.

### Restart receiver with secret

```bash
# Terminal 1 (Ctrl+C to stop, then restart with secret)
WEBHOOK_SECRET=whsec_YOUR_SECRET node test-receiver.js
```

### Trigger events

```bash
# Terminal 3
curl -X POST https://YOUR-APP.api.codehooks.io/dev/events/trigger/user.created \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{"userId": "user_123", "email": "test@example.com"}'
```

Watch Terminal 1 - you should see the webhook received and verified!

## What's Next?

### Explore the API

Check out [CURL_EXAMPLES.md](CURL_EXAMPLES.md) for all available API operations.

### Integrate into your app

Add event triggers to your application:

```javascript
// In your app when something happens
await fetch('https://YOUR-APP.api.codehooks.io/dev/events/trigger/order.created', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-apikey': process.env.CODEHOOKS_API_KEY
  },
  body: JSON.stringify({
    orderId: order.id,
    customerId: customer.id,
    total: order.total
  })
});
```

### Implement a receiver

Use the examples in [examples/](examples/) to implement a webhook receiver in your language:
- [Node.js](test-receiver.js)
- [Python](examples/receiver-python.py)
- [Go](examples/receiver-go.go)

### Read the docs

- [README.md](README.md) - Complete documentation
- [BLOG_POST.md](BLOG_POST.md) - In-depth guide and best practices
- [examples/README.md](examples/README.md) - Receiver implementation guides

## Common Commands

```bash
# List all webhooks
curl https://YOUR-APP.api.codehooks.io/dev/webhooks \
  -H "x-apikey: YOUR_API_KEY"

# Get webhook details
curl https://YOUR-APP.api.codehooks.io/dev/webhooks/WEBHOOK_ID \
  -H "x-apikey: YOUR_API_KEY"

# Check webhook statistics
curl https://YOUR-APP.api.codehooks.io/dev/webhooks/WEBHOOK_ID/stats \
  -H "x-apikey: YOUR_API_KEY"

# Update webhook
curl -X PATCH https://YOUR-APP.api.codehooks.io/dev/webhooks/WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{"status": "paused"}'

# Delete webhook
curl -X DELETE https://YOUR-APP.api.codehooks.io/dev/webhooks/WEBHOOK_ID \
  -H "x-apikey: YOUR_API_KEY"

# Trigger event
curl -X POST https://YOUR-APP.api.codehooks.io/dev/events/trigger/EVENT_TYPE \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{"key": "value"}'
```

## Troubleshooting

### Webhook verification fails

- Check the ngrok URL is correct
- Ensure the test receiver is running
- Try Stripe-style verification instead of Slack-style

### Signature verification fails

- Ensure you set the `WEBHOOK_SECRET` environment variable
- Use the exact secret from the webhook registration response
- Verify you're using the raw request body (not parsed JSON)

### Not receiving webhooks

- Check webhook status: should be `active`
- Verify your endpoint is publicly accessible
- Check ngrok is still running
- Look at Codehooks logs: `coho logs --tail 50`

## Need Help?

- Check the [README.md](README.md)
- Read the [blog post](BLOG_POST.md)
- Join [Codehooks.io Discord](https://discord.gg/codehooks)
- Report issues on [GitHub](https://github.com/codehooks-io/codehooks-io-templates/issues)
