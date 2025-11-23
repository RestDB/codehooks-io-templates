# Build a Webhook Delivery System in 5 Minutes with Codehooks.io

You've built an amazing application. Users love it. Now they're asking: "Can you send webhooks when events happen?"

Maybe it's:
- An e-commerce platform where customers want order notifications and webhook delivery
- A SaaS tool where users need real-time webhook alerts
- An IoT system where devices trigger external workflows via webhooks
- A business application where events need webhook integration with other systems

**The problem?** Building a production-ready webhook delivery system from scratch takes weeks. Setting up webhook infrastructure, managing webhook queues, and handling webhook retries is complex.

**The solution?** Use this Codehooks.io webhook template and have webhook delivery running in 5 minutes.

## What Problem Does This Solve?

Imagine you're building an order management system. Your customers want to know immediately when orders are created, payments are processed, or items are shipped.

They don't want to poll your API every few seconds. They want **webhooks** - real-time HTTP callbacks with webhook delivery when events occur.

But you don't want to spend weeks building webhook infrastructure, webhook queues, and webhook retry logic. You want to focus on your core product.

**This webhook template solves that.** Deploy it once, and you have a complete webhook delivery system with automatic retries, HMAC signing, and queue-based processing.

## Why Not Build It Yourself?

Building webhooks from scratch means implementing:
- Webhook registration system with CRUD API
- Webhook URL verification (Stripe and Slack styles)
- Webhook security (HMAC signing, SSRF protection, timestamp validation)
- Webhook delivery infrastructure (queues, retries, timeouts)
- Webhook monitoring and auto-disable for failing endpoints
- Documentation and examples

**Estimated time:** 2-4 weeks for an experienced developer.

**Maintenance:** Ongoing updates, security patches, webhook scaling issues.

## Webhook Solutions Comparison

### Webhook Infrastructure Services

Several services exist for webhook delivery:

**[Webhook Relay](https://webhookrelay.com/)** - Webhook forwarding and tunneling service. Great for routing webhooks to private networks, but you still need to build the webhook delivery logic yourself. Pricing starts at $7.50/month.

**[Hookdeck](https://hookdeck.com/)** - Webhook infrastructure platform. Excellent for receiving and routing webhooks, but primarily focused on inbound webhooks. For outbound webhooks, you need their paid plans starting at $15/month.

**[Svix](https://www.svix.com/)** - Dedicated webhook sending service. Powerful but expensive ($250/month for production). Closed-source SaaS with vendor lock-in.

**[Zapier Webhooks](https://zapier.com/apps/webhooks/integrations)** - Webhook automation. Great for no-code workflows, but limited customization and can be costly at scale ($20-$50+/month).

### The Codehooks.io Advantage: Code-First + AI

**Codehooks.io takes a different approach:** Instead of a rigid SaaS platform, you get **full source code** that you can deploy, customize, and enhance with AI assistance.

**Why this matters:**

1. **Full Control** - You own the code. Modify webhook payload structure, add custom headers, implement tenant-specific logic, or integrate with your existing systems. No API limitations.

2. **AI-Powered Customization** - Use Claude, ChatGPT, or any LLM to modify the template instantly:
   - "Add webhook batching for high-frequency events"
   - "Implement custom retry logic based on HTTP status codes"
   - "Add webhook filtering by customer tier"
   - The AI understands your code and makes changes directly

3. **Cost-Effective** - Free tier for development. Production plans start at $19/month with generous API limits and predictable costs. No surprise bills as you scale.

4. **No Vendor Lock-In** - The code is yours. Move it anywhere if needed. Export your webhook data anytime.

5. **Production-Ready Template** - Don't start from scratch. Get queue-based delivery, HMAC signing, retry logic, SSRF protection, and webhook monitoring out of the box.

6. **Serverless Scaling** - Automatic scaling built into Codehooks.io. Handle 10 webhooks or 10,000 without infrastructure changes.

**The code-first approach means you get the best of both worlds:** rapid deployment like a SaaS platform, but with the flexibility and cost-effectiveness of custom code.

## Deploy Your Webhook System in 5 Minutes

Instead of weeks of development or expensive SaaS subscriptions:

```bash
coho create mywebhooks --template webhook-delivery
cd mywebhooks
npm install
coho deploy
```

**Time:** 5 minutes.

**Cost:** Free tier for development, pick a paid plan suitable for production volumes.

**Customization:** Ask an AI to modify the code for your exact needs.

**Maintenance:** Platform handles scaling, security, and infrastructure.

## Quick Start

### 1. Deploy (2 minutes)

```bash
coho create mywebhooks --template webhook-delivery
cd mywebhooks
npm install
coho deploy
```

You'll get a URL like: `https://my-webhooks-abc123.api.codehooks.io/dev`

### 2. Test (2 minutes)

```bash
export API_URL="https://my-webhooks-abc123.api.codehooks.io/dev"
export CODEHOOKS_API_KEY="your-api-key-here"

# Register a webhook (use webhook.site for testing)
curl -X POST $API_URL/webhooks \
  -H "Content-Type: application/json" \
  -H "x-apikey: $CODEHOOKS_API_KEY" \
  -d '{
    "clientId": "test-client-1",
    "url": "https://webhook.site/your-unique-id",
    "events": ["order.created"]
  }'

# Trigger an event
curl -X POST $API_URL/events/trigger/order.created \
  -H "Content-Type: application/json" \
  -H "x-apikey: $CODEHOOKS_API_KEY" \
  -d '{"orderId": "12345", "total": 99.99}'
```

Check webhook.site - your webhook was delivered! 🎉

## How to Use It From Your App

Once deployed, integrate webhook triggering into your application code:

### From Node.js/JavaScript

```javascript
// In your order creation code
async function createOrder(orderData) {
  const order = await db.orders.insertOne(orderData);

  // Trigger webhook event
  fetch(`${WEBHOOK_SERVICE_URL}/events/trigger/order.created`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-apikey': process.env.CODEHOOKS_API_KEY
    },
    body: JSON.stringify({
      orderId: order.id,
      total: order.total,
      createdAt: order.createdAt
    })
  }).catch(err => console.error('Webhook trigger failed:', err));

  return order;
}
```

### From Python

```python
import requests
import os

def create_order(order_data):
    order = db.orders.insert_one(order_data)

    # Trigger webhook event
    try:
        requests.post(
            f"{WEBHOOK_SERVICE_URL}/events/trigger/order.created",
            headers={"x-apikey": os.environ["CODEHOOKS_API_KEY"]},
            json={"orderId": str(order.inserted_id), "total": order_data["total"]},
            timeout=5
        )
    except Exception as e:
        print(f"Webhook trigger failed: {e}")

    return order
```

### From Any Language

Just make an HTTP POST request:

```bash
curl -X POST https://your-webhook-service.api.codehooks.io/dev/events/trigger/order.created \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_CODEHOOKS_API_KEY" \
  -d '{"orderId": "12345", "total": 99.99}'
```

**That's it!** The webhook delivery service handles:
- Finding all subscribed webhook endpoints
- Webhook payload signing with HMAC SHA-256
- Webhook delivery to each URL via queue-based system
- Automatic webhook retries on failure (exponential backoff)
- Auto-disabling failing webhook endpoints

## What You Get

### Webhook Management API

Your application manages webhook subscriptions on behalf of customers:

```bash
POST /webhooks           # Register webhook endpoint
GET /webhooks            # List all webhook subscriptions
GET /webhooks/:id        # Get webhook details
PATCH /webhooks/:id      # Update webhook configuration
DELETE /webhooks/:id     # Delete webhook subscription
GET /webhooks/:id/stats  # Webhook delivery statistics
POST /webhooks/:id/retry # Retry failed webhook deliveries
```

**Important:** This webhook API is for **your application**, not directly exposed to customers. Build your own UI where customers configure webhook endpoints, then your backend calls this webhook service.

**Webhook Integration Flow:**
1. Customer enters webhook URL in **your UI**
2. **Your backend** calls `POST /webhooks` to register the webhook
3. When events occur, **your app** calls `POST /events/trigger/:eventType`
4. Webhook delivery service delivers to all registered webhook endpoints

### Flexible Webhook Events

Any webhook event name works - no configuration needed:

```javascript
POST /events/trigger/order.created
POST /events/trigger/payment.succeeded
POST /events/trigger/sensor.reading
POST /events/trigger/anything.you.want
```

### Webhook Security & Reliability Features

- **Webhook Signing**: HMAC SHA-256 payload signing with unique secrets per webhook
- **Webhook Verification**: URL verification (Stripe and Slack styles)
- **SSRF Protection**: Blocks webhook delivery to internal IPs
- **Queue-Based Delivery**: Scalable webhook queue system handles thousands of concurrent deliveries
- **Automatic Webhook Retries**: 3 attempts with exponential backoff for failed webhooks
- **Webhook Monitoring**: Auto-disable after 10 consecutive failures
- **Webhook Audit Trail**: 90-day event retention for debugging and replay

## Real-World Examples

### E-Commerce Platform

```javascript
// When order is created
await fetch(`${WEBHOOK_URL}/events/trigger/order.created`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-apikey': process.env.CODEHOOKS_API_KEY
  },
  body: JSON.stringify({ orderId, items, shippingAddress })
});
```

### SaaS Analytics

```python
# When report is ready
requests.post(
    f"{webhook_url}/events/trigger/report.completed",
    headers={"x-apikey": os.environ["CODEHOOKS_API_KEY"]},
    json={"reportId": report_id, "downloadUrl": url}
)
```

### IoT Monitoring

```go
// When sensor detects anomaly
import (
    "bytes"
    "encoding/json"
    "net/http"
    "os"
)

payload := map[string]interface{}{
    "deviceId":    device.ID,
    "temperature": reading.Temperature,
}
jsonData, _ := json.Marshal(payload)

req, _ := http.NewRequest("POST",
    webhookURL+"/events/trigger/sensor.alert",
    bytes.NewBuffer(jsonData))
req.Header.Set("Content-Type", "application/json")
req.Header.Set("x-apikey", os.Getenv("CODEHOOKS_API_KEY"))

http.DefaultClient.Do(req)
```

## FAQ

### Q: How does authentication work?

**A:** Two security layers:

1. **Your app → Webhook service**: Secured by Codehooks.io authentication
2. **Webhook service → Customer URLs**: HMAC SHA-256 signed payloads

Don't expose the webhook service directly to customers. Build your own UI/API:

```javascript
// In YOUR API
app.post('/api/customer/webhooks', authenticateCustomer, async (req, res) => {
  const customer = req.customer;

  // Create or update webhook in the webhook service
  const response = await fetch(`${WEBHOOK_SERVICE}/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-apikey': process.env.CODEHOOKS_API_KEY
    },
    body: JSON.stringify({
      clientId: customer.id, // Use customer ID as clientId
      url: req.body.url,
      events: req.body.events,
      metadata: {
        customerName: customer.name,
        tier: customer.tier
      }
    })
  });

  const webhook = await response.json();

  // Webhook automatically updates if customer registers same URL again
  res.json({
    success: true,
    webhookId: webhook.id,
    message: webhook.message // "Webhook created" or "Webhook updated"
  });
});
```

### Q: What if a customer's webhook endpoint is down?

The webhook delivery system automatically:
- Retries webhook delivery 3 times with exponential backoff
- Tracks consecutive webhook failures
- Auto-disables webhook after 10 consecutive failures
- Provides `/webhooks/:id/retry` endpoint to re-enable webhook delivery

### Q: Can customers receive all webhook events?

Yes! Register webhook with `"events": ["*"]` to receive all webhook events.

### Q: Can I customize the webhook payload format?

Yes! The event data you send becomes the webhook payload:

```javascript
// You send:
POST /events/trigger/order.created
{"orderId": "123", "total": 99.99}

// Customers receive:
{
  "id": "evt_abc...",
  "type": "order.created",
  "created": 1234567890,
  "data": {
    "orderId": "123",
    "total": 99.99
  }
}
```

### Q: How do I test webhook delivery locally?

Three options for webhook testing:
1. **webhook.site** - Free service that displays received webhook payloads
2. **ngrok** - Tunnel webhook delivery to your local server
3. **Test receiver** - Included in template (`node test-receiver.js`)

### Q: Can I modify the webhook template?

Absolutely! The code-first approach makes webhook customization easy. Common webhook modifications:
- Add custom headers to webhook deliveries
- Implement custom webhook verification methods
- Add rate limiting per customer for webhook endpoints
- Filter webhook events by tenant ID
- Batch webhook delivery for high-frequency events
- Modify webhook retry logic based on HTTP status codes
- Add webhook delivery priority queues

**Pro tip:** Use Claude Code or ChatGPT to modify the webhook template instantly. Just describe what you want, and the AI will make the changes to your webhook delivery system.

## Get Started with Webhook Delivery

Deploy your webhook system in minutes:

```bash
coho create mywebhooks --template webhook-delivery
cd mywebhooks
coho deploy
```

Integrate webhook delivery into your app:

```javascript
await fetch(`${WEBHOOK_URL}/events/trigger/${eventType}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-apikey': process.env.CODEHOOKS_API_KEY
  },
  body: JSON.stringify(eventData)
});
```

The webhook delivery system handles everything else automatically.

## Why Choose Codehooks.io for Webhooks?

**vs. Building from Scratch**: Save 2-4 weeks of development time. Get production-ready webhook infrastructure immediately.

**vs. Webhook Relay / Hookdeck**: You own the webhook code. Full customization with AI assistance. Lower cost at scale.

**vs. Svix**: 10x cheaper for webhook delivery. No vendor lock-in. Modify webhook logic directly in your codebase.

**vs. Zapier**: Developer-focused webhook solution. API-first, not UI-first. Unlimited webhook customization.

**The Codehooks.io difference**: Code-first webhook platform that combines rapid deployment, AI-powered customization, and cost-effective scaling.

## Webhook Resources

- [Complete Webhook Template on GitHub](https://github.com/codehooks-io/codehooks-io-templates/tree/main/webhook-delivery)
- [Codehooks.io Documentation](https://codehooks.io/docs)
- [Webhook API Reference](./CURL_EXAMPLES.md)
- [Webhook Architecture Guide](./ARCHITECTURE.md)
- [Webhook Quick Start Guide](./QUICKSTART.md)

---

**Questions about webhook delivery?** Open an issue on [GitHub](https://github.com/codehooks-io/codehooks-io-templates/issues).

**Keywords**: webhook delivery, webhooks, webhook infrastructure, webhook API, webhook system, outgoing webhooks, webhook queue, webhook retries, webhook HMAC signing, webhook monitoring, webhook integration, webhook service, webhook platform, webhook management
