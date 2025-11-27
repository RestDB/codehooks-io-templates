# Webhook Delivery System

A production-ready webhook delivery system for Codehooks.io that allows you to send webhooks to external services when events occur in your application. Perfect for developers who need a robust webhook delivery system without building one from scratch.

## Use Case

You have a system that fires events, but don't want to build a full-fledged robust solution for webhook delivery? This template provides everything you need to let other systems, customers, or clients subscribe to your webhooks. Just trigger events via a simple API call, and this system handles all the complexity of reliable webhook delivery.

## Features

- ✅ **Workflow Queue-Based Delivery** - Scalable async processing using Codehooks workflow queues
- ✅ **Any Event Type** - No restrictions, supports any custom event names
- ✅ **API Key Authentication** - Secure CRUD endpoints with API key protection
- ✅ **Complete CRUD API** - Full webhook lifecycle management
- ✅ **Automatic URL Verification** - Stripe & Slack styles supported
- ✅ **Secure Signing** - HMAC SHA-256 payload signing
- ✅ **Smart Retries** - Automatic retry with exponential backoff (3 attempts)
- ✅ **Health Monitoring** - Delivery statistics and failure tracking
- ✅ **Auto-Disable** - Automatically disables consistently failing webhooks
- ✅ **Wildcard Support** - Subscribe to all events with `*`
- ✅ **Audit Trail** - Event logging for compliance and debugging
- ✅ **Production-Ready** - Proper error handling, timeouts, and SSRF protection

>[Read blog post about webhook delivery here.](https://codehooks.io/blog/build-webhook-delivery-system-5-minutes-codehooks-io)

## What are Outgoing Webhooks?

Outgoing webhooks (also called "reverse webhooks" or "webhook delivery") allow your application to notify external services when events occur. When something happens in your system (user created, order placed, payment completed, etc.), your application sends HTTP POST requests to registered webhook URLs.

This is the opposite of incoming webhooks, where external services notify your application.

## Use Cases

- Notify customers when their order status changes
- Send real-time updates to external dashboards
- Trigger workflows in other applications (Zapier, n8n, etc.)
- Sync data between systems
- Alert monitoring systems about important events
- Enable third-party integrations

## Quick Start

### 1. Deploy to Codehooks.io

```bash
coho create mywebhooks --template webhook-delivery
cd mywebhooks
npm install
coho deploy
```

### 2. Configure API Access

The webhook service is secured by Codehooks.io built-in authentication. Manage API tokens using the CLI:

```bash
# Add an API token
coho add-token --description "My webhook integration"

# List tokens
coho tokens

# Remove a token
coho remove-token <token-id>
```

Or manage tokens via Codehooks Studio: Settings → API Tokens

**Tip:** For different environments, add spaces to your project:
```bash
# Project comes with 'dev' space by default
# Add a production space
coho add prod

# Switch to production and deploy
coho use prod
coho deploy

# Switch back to dev
coho use dev
```

### 3. Register a webhook

```bash
curl -X POST https://your-project.api.codehooks.io/dev/webhooks \
  -H "Content-Type: application/json" \
  -H "x-apikey: your-api-key" \
  -d '{
    "clientId": "customer-123",
    "url": "https://your-service.com/webhook",
    "events": ["user.created", "user.updated"],
    "verificationType": "stripe"
  }'
```

**Note:** The `clientId` is a unique identifier for the webhook listener (e.g., customer ID, tenant ID, or application ID). If you register a webhook with the same `clientId` and `url`, it will **update** the existing webhook instead of creating a duplicate.

Response:
```json
{
  "id": "abc123",
  "url": "https://your-service.com/webhook",
  "events": ["user.created", "user.updated"],
  "secret": "whsec_8f3h2...",
  "clientId": "customer-123",
  "status": "pending_verification",
  "verificationToken": "tok_9j2k...",
  "message": "Webhook created. Verification in progress."
}
```

### 4. Trigger an event

```bash
curl -X POST https://your-project.api.codehooks.io/dev/events/trigger/user.created \
  -H "Content-Type: application/json" \
  -H "x-apikey: your-api-key" \
  -d '{
    "userId": "user_123",
    "email": "john@example.com",
    "name": "John Doe"
  }'
```

## API Reference

### Authentication

All endpoints require an API key (both webhook management and event triggering):

```bash
-H "x-apikey: your-api-key"
```

**Managing API Tokens:**
```bash
# Add a token for your application
coho add-token --description "My webhook integration"

# List all tokens
coho tokens

# Remove a token if needed
coho remove-token <token-id>

# Or manage via Codehooks Studio: Settings → API Tokens
```

**Note:** For different environments, add spaces to your project:
```bash
# Add production space
coho add prod

# Switch to prod and deploy
coho use prod
coho deploy
```

### Webhook Management

#### Create or Update Webhook
```
POST /webhooks
Headers: x-apikey: your-api-key
```

Request body:
```json
{
  "clientId": "customer-123",
  "url": "https://your-service.com/webhook",
  "events": ["user.created", "order.completed", "*"],
  "verificationType": "stripe",
  "metadata": {
    "description": "Production webhook for order system"
  }
}
```

**Fields:**
- `clientId` (required): Unique identifier for the webhook listener (e.g., customer ID, tenant ID)
- `url` (required): Webhook endpoint URL
- `events` (required): Array of event types to subscribe to (use `["*"]` for all events)
- `verificationType` (optional): `"stripe"` or `"slack"` (default: `"stripe"`)
- `metadata` (optional): Additional data to store with the webhook

**Upsert Behavior:** If a webhook with the same `clientId` and `url` already exists, it will be updated. This prevents duplicate webhook registrations.

#### List Webhooks
```
GET /webhooks?status=active&event=user.created
```

#### Get Webhook Details
```
GET /webhooks/:id
```

#### Update Webhook
```
PATCH /webhooks/:id
```

Request body:
```json
{
  "url": "https://new-url.com/webhook",
  "events": ["order.created", "order.completed"],
  "status": "active"
}
```

#### Delete Webhook
```
DELETE /webhooks/:id
```

#### Retry Failed Webhook
```
POST /webhooks/:id/retry
```

#### Get Webhook Statistics
```
GET /webhooks/:id/stats
```

### Event Triggering

#### Trigger Event
```
POST /events/trigger/:eventType
```

Example:
```bash
curl -X POST https://your-project.api.codehooks.io/dev/events/trigger/payment.succeeded \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "pay_123",
    "amount": 5000,
    "currency": "usd",
    "customerId": "cus_456"
  }'
```

## Event Types

**Any event type is supported!** There are no restrictions on event names - use whatever makes sense for your application:

- `user.created`, `user.updated`, `user.deleted`
- `order.placed`, `order.shipped`, `order.delivered`
- `payment.succeeded`, `invoice.paid`
- `document.uploaded`, `file.processed`
- `task.completed`, `workflow.finished`
- `custom.event.name` - literally anything!
- `*` (wildcard - receives all events)

**Examples:**
```bash
# E-commerce events
curl -X POST $API_URL/events/trigger/product.restocked -d '{"sku":"ABC123"}'

# IoT events
curl -X POST $API_URL/events/trigger/sensor.reading -d '{"temp":72.5}'

# Custom business events
curl -X POST $API_URL/events/trigger/report.generated -d '{"reportId":"rpt_001"}'
```

The system is completely flexible - use any event naming convention that fits your domain.

## Client ID and Idempotent Registration

### What is clientId?

Every webhook registration requires a `clientId` - a unique identifier for the webhook listener. This is typically:
- Customer ID in a multi-tenant SaaS application
- Tenant ID in an enterprise system
- Application ID for service-to-service webhooks
- User ID for personal integrations

### Upsert Behavior

The webhook registration endpoint (`POST /webhooks`) uses **upsert logic** based on `clientId` + `url`:

```javascript
// First registration - creates webhook
POST /webhooks {
  "clientId": "customer-123",
  "url": "https://example.com/webhook",
  "events": ["order.created"]
}
// Result: 201 Created

// Same clientId + url - updates webhook
POST /webhooks {
  "clientId": "customer-123",
  "url": "https://example.com/webhook",
  "events": ["order.created", "order.shipped"]  // Changed events
}
// Result: 200 OK - webhook updated, secret preserved
```

**Benefits:**
- ✅ **No duplicates** - Same clientId + URL = same webhook
- ✅ **Idempotent** - Safe to call multiple times
- ✅ **Secret preserved** - Existing webhooks keep their HMAC secret on update
- ✅ **Automatic cleanup** - Updating events automatically removes old subscriptions

### Use Cases

**Multi-tenant SaaS:**
```javascript
// Each customer can register one webhook per URL
fetch('/webhooks', {
  body: JSON.stringify({
    clientId: customer.id,  // Customer's unique ID
    url: customer.webhookUrl,
    events: customer.selectedEvents
  })
});
```

**Multiple webhooks per client:**
```javascript
// Same customer, different URLs = different webhooks
POST /webhooks { "clientId": "customer-123", "url": "https://a.com/hook" }
POST /webhooks { "clientId": "customer-123", "url": "https://b.com/hook" }
// Both webhooks are registered
```

## Architecture: Queue-Based Delivery

This system uses **Codehooks Queue API with `enqueueFromQuery`** for efficient, scalable webhook delivery:

### How It Works

1. **Event Triggered**: Your app calls `/events/trigger/:eventType`
2. **Event Stored**: Event is logged in database for audit trail
3. **Mark Webhooks**: All matching active webhooks are tagged with `pendingEventId`
4. **Bulk Queue**: `enqueueFromQuery` queues ALL matching webhooks in one atomic operation
5. **Queue Consumer**: `app.worker('webhook-delivery')` processes messages in parallel
6. **Fetch Event**: Worker retrieves event data from database using `pendingEventId`
7. **Webhook Delivery**: Each webhook is delivered with HMAC signature verification
8. **Auto Retries**: Queue automatically retries failed deliveries
9. **Stats Updated**: Delivery statistics tracked in real-time

### Code Overview

```javascript
// Event triggering - bulk queue operation
// 1. Store event in database
await conn.insertOne('events', { ...eventData, processedAt: new Date().toISOString() });

// 2. Mark all matching webhooks with the event ID
await conn.updateMany(
  'webhooks',
  { status: 'active', $or: [{ events: eventType }, { events: '*' }] },
  { $set: { pendingEventId: eventData.id } }
);

// 3. Queue all marked webhooks in one operation
const result = await conn.enqueueFromQuery(
  'webhooks',
  { status: 'active', pendingEventId: eventData.id },
  'webhook-delivery'
);

// Worker processes messages from queue (runs in parallel)
async function webhookDeliveryWorker(req, res) {
  const webhook = req.body.payload; // Webhook from enqueueFromQuery

  // Fetch event data from database
  const conn = await getDB();
  const eventDoc = await conn.getOne('events', { id: webhook.pendingEventId });

  // Deliver webhook with HMAC signature
  await deliverWebhook(webhook, eventDoc);

  // Clear pendingEventId and return success
  await conn.updateOne('webhooks', { _id: webhook._id },
    { $set: { pendingEventId: null, consecutiveFailures: 0 } }
  );

  res.end(JSON.stringify({ success: true }));
}

app.worker('webhook-delivery', webhookDeliveryWorker);
```

### Benefits

- **⚡ Ultra-Fast**: Bulk queue operation - no loops, one atomic database operation
- **💾 Memory Efficient**: Doesn't load all webhooks into memory
- **🚀 Scalable**: Handle thousands of webhooks simultaneously
- **🔄 Reliable**: Automatic retries on failures
- **⏱️ Non-Blocking**: API returns 202 Accepted immediately
- **🛡️ Fault Tolerant**: Queue handles failures gracefully
- **⏳ Long Running**: Configurable timeout per webhook

### Example Flow

```bash
# 1. Trigger event (returns immediately)
curl -X POST $API_URL/events/trigger/order.placed \
  -d '{"orderId":"123","total":99.99}'

# Response (202 Accepted in milliseconds):
{
  "message": "Event accepted for delivery",
  "eventId": "evt_abc123",
  "webhookCount": 1247,
  "queuedAt": "2025-01-22T10:30:00.000Z"
}

# 2. Queue processes 1247 webhooks in parallel
# 3. Stats are updated as deliveries complete
# 4. Check stats anytime:
curl -H "x-apikey: $API_KEY" $API_URL/webhooks/webhook_id/stats
```

This architecture ensures instant event triggering and reliable delivery, even with thousands of subscribers.

## Webhook Verification

When you register a webhook, the system automatically verifies that the URL is valid and can receive webhooks. Two verification methods are supported:

### Stripe-Style Verification

The system sends a test payload with a verification token:

```json
{
  "type": "webhook.verification",
  "verification_token": "tok_abc123...",
  "created": 1234567890
}
```

Your endpoint should respond with HTTP 200 to pass verification.

### Slack-Style Verification

The system sends a challenge parameter:

```json
{
  "type": "url_verification",
  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
  "token": "tok_abc123..."
}
```

Your endpoint should respond with:

```json
{
  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P"
}
```

## Receiving Webhooks

### Webhook Payload Format

When an event is triggered, registered webhooks receive:

```json
{
  "id": "evt_1a2b3c4d",
  "type": "user.created",
  "data": {
    "userId": "user_123",
    "email": "john@example.com",
    "name": "John Doe"
  },
  "created": 1234567890
}
```

### Security Headers

Every webhook request includes security headers:

- `X-Webhook-Signature`: HMAC SHA-256 signature (format: `v1=<signature>`)
- `X-Webhook-Timestamp`: Unix timestamp when webhook was sent
- `X-Webhook-Id`: Webhook subscription ID
- `Content-Type`: application/json

### Verifying Webhook Signatures

Always verify webhook signatures to ensure requests come from your system:

#### Node.js Example

```javascript
import crypto from 'crypto';

function verifyWebhookSignature(payload, signature, timestamp, secret) {
  // Reject old requests (older than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    return false;
  }

  // Compute expected signature
  const sigBasestring = `${timestamp}.${payload}`;
  const expectedSignature = 'v1=' + crypto
    .createHmac('sha256', secret)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  // Compare signatures
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch {
    return false;
  }
}

// Express.js example
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const secret = 'whsec_your_secret_here';

  if (!verifyWebhookSignature(req.body.toString(), signature, timestamp, secret)) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body);
  console.log('Received event:', event.type);

  // Process the event
  // ...

  res.status(200).send('OK');
});
```

#### Python Example

```python
import hmac
import hashlib
import time

def verify_webhook_signature(payload, signature, timestamp, secret):
    # Reject old requests
    current_time = int(time.time())
    if abs(current_time - int(timestamp)) > 300:
        return False

    # Compute expected signature
    sig_basestring = f"{timestamp}.{payload}"
    expected_signature = "v1=" + hmac.new(
        secret.encode('utf-8'),
        sig_basestring.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Compare signatures
    return hmac.compare_digest(expected_signature, signature)

# Flask example
@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Webhook-Signature')
    timestamp = request.headers.get('X-Webhook-Timestamp')
    secret = 'whsec_your_secret_here'

    if not verify_webhook_signature(request.data.decode(), signature, timestamp, secret):
        return 'Invalid signature', 401

    event = request.json
    print(f"Received event: {event['type']}")

    # Process the event
    # ...

    return 'OK', 200
```

## Retry Logic

The system automatically retries failed webhook deliveries:

- **Maximum retries**: 3 attempts
- **Backoff strategy**: Exponential (1s, 2s, 4s)
- **Timeout**: 10 seconds per request
- **Auto-disable**: After 10 consecutive failures

## Webhook Statuses

- `pending_verification`: Initial state, verification in progress
- `active`: Verified and receiving events
- `verification_failed`: URL verification failed
- `paused`: Temporarily disabled by user
- `disabled`: Automatically disabled due to failures

## Monitoring and Debugging

### Check webhook statistics

```bash
curl https://your-project.api.codehooks.io/dev/webhooks/:id/stats \
  -H "x-apikey: YOUR_API_KEY"
```

Response:
```json
{
  "id": "abc123",
  "deliveryCount": 1247,
  "consecutiveFailures": 0,
  "lastDeliveryAt": "2025-01-15T10:30:00.000Z",
  "lastDeliveryStatus": "success",
  "status": "active"
}
```

### View logs

```bash
coho logs --tail 50
```

## Integration Examples

### n8n Workflow

1. Create a webhook trigger node in n8n
2. Copy the webhook URL
3. Register the webhook with your Codehooks.io app
4. n8n will automatically verify the webhook
5. Events will now trigger your n8n workflow

### Zapier

1. Create a "Webhooks by Zapier" trigger with "Catch Hook"
2. Copy the webhook URL
3. Register the webhook with `verificationType: "stripe"`
4. Send a test event to activate the Zap

### Custom Application

See the code examples in the "Receiving Webhooks" section above.

## Testing Locally

### Create a test receiver endpoint

Create a simple test server to receive webhooks:

```javascript
// test-receiver.js
import express from 'express';
const app = express();

app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('Received webhook:');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  res.status(200).send('OK');
});

app.listen(3000, () => {
  console.log('Test receiver running on http://localhost:3000');
});
```

### Use ngrok for testing

```bash
# Terminal 1: Start test receiver
node test-receiver.js

# Terminal 2: Expose via ngrok
ngrok http 3000

# Terminal 3: Register webhook with ngrok URL
curl -X POST https://your-project.api.codehooks.io/dev/webhooks \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{
    "clientId": "test-local",
    "url": "https://your-ngrok-url.ngrok.io/webhook",
    "events": ["*"]
  }'
```

## Database Schema

Webhooks are stored in the `webhooks` collection with this structure:

```javascript
{
  _id: "abc123",
  clientId: "customer-123",
  url: "https://your-service.com/webhook",
  events: ["user.created", "order.completed"],
  secret: "whsec_...",
  verificationToken: "tok_...",
  verificationType: "stripe",
  status: "active",
  metadata: { description: "Production webhook" },
  pendingEventId: "evt_456",           // Event ID being processed (null when idle)
  pendingEventType: "user.created",    // Event type being processed
  createdAt: "2025-01-15T10:00:00.000Z",
  updatedAt: "2025-01-15T10:00:05.000Z",
  verifiedAt: "2025-01-15T10:00:05.000Z",
  deliveryCount: 1247,
  consecutiveFailures: 0,
  lastDeliveryAt: "2025-01-15T10:30:00.000Z",
  lastDeliveryStatus: "success",
  lastDeliveryError: null,
  disabledReason: null
}
```

## Customization

### Event Types

No configuration needed - any event type is supported! Just trigger with any name:

```bash
POST /events/trigger/my.custom.event
POST /events/trigger/invoice.paid
POST /events/trigger/sensor.temperature.alert
```

Use `'*'` when registering webhooks to receive all events:

```bash
curl -X POST -H "x-apikey: $API_KEY" $API_URL/webhooks \
  -d '{"url": "https://example.com/hook", "events": ["*"]}'
```


## Production Considerations


### Authentication

All routes are secured by Codehooks.io built-in authentication. API tokens are managed via CLI or Codehooks Studio:

```bash
# Add a token for your application
coho add-token --description "My application"

# Use the token in API requests
curl -H "x-apikey: <your-token>" https://your-project.api.codehooks.io/dev/webhooks
```

### Monitoring

Set up monitoring alerts for:
- High webhook failure rates
- Slow webhook response times
- Disabled webhooks

### Scaling

For high-volume applications:
- Use a message queue (Redis, RabbitMQ) for webhook delivery
- Implement webhook batching
- Add dedicated worker processes for webhook delivery

## Troubleshooting

### Webhook verification fails

1. Check that your endpoint returns HTTP 200
2. Verify your endpoint can receive POST requests
3. For Slack-style verification, ensure you return the challenge parameter
4. Check firewall and security settings

### Webhooks not being delivered

1. Check webhook status: `GET /webhooks/:id`
2. Verify the webhook is `active`
3. Check the event type matches your webhook subscription
4. Review logs: `coho logs --tail 100`
5. Check for connectivity issues with your endpoint

### High failure rate

1. Check endpoint URL is correct and accessible
2. Verify signature verification is working correctly
3. Ensure endpoint responds within 10 seconds
4. Check endpoint logs for errors
5. Use the retry endpoint: `POST /webhooks/:id/retry`

## Resources

- [Codehooks.io Documentation](https://codehooks.io/docs)
- [Webhook Security Best Practices](https://webhooks.fyi/best-practices/security)
- [Stripe Webhook Documentation](https://stripe.com/docs/webhooks)
- [Slack Events API](https://api.slack.com/apis/connections/events-api)

## License

MIT

## Support

For issues and questions:
- [GitHub Issues](https://github.com/codehooks-io/codehooks-io-templates/issues)
- [Codehooks.io Discord](https://discord.gg/codehooks)
