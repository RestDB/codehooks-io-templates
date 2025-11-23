# CURL Examples

Quick reference for testing the webhook API with curl commands.

Replace `https://your-app.api.codehooks.io/dev` with your actual Codehooks.io API URL.

## Setup

```bash
# Set your API URL as environment variable
export API_URL="https://your-app.api.codehooks.io/dev"

# Note: All endpoints are secured by Codehooks.io built-in authentication
# Use the Codehooks CLI or dashboard to manage access tokens
```

## Health Check

```bash
curl $API_URL/
```

## Webhook Management

### Create a webhook (Stripe-style verification)

```bash
curl -X POST $API_URL/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-service.com/webhook",
    "events": ["user.created", "user.updated"],
    "verificationType": "stripe",
    "metadata": {
      "environment": "production",
      "description": "User events webhook"
    }
  }'
```

### Create a webhook (Slack-style verification)

```bash
curl -X POST $API_URL/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-service.com/webhook",
    "events": ["order.created", "order.completed"],
    "verificationType": "slack"
  }'
```

### Create a webhook that receives all events

```bash
curl -X POST $API_URL/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-service.com/webhook",
    "events": ["*"]
  }'
```

### Create webhook with custom event names

```bash
curl -X POST $API_URL/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-service.com/webhook",
    "events": ["sensor.reading", "device.online", "alert.triggered"]
  }'
```

### List all webhooks

```bash
curl $API_URL/webhooks
```

### List active webhooks only

```bash
curl "$API_URL/webhooks?status=active"
```

### List webhooks for a specific event

```bash
curl "$API_URL/webhooks?event=user.created"
```

### Get a specific webhook

```bash
curl $API_URL/webhooks/WEBHOOK_ID
```

### Update a webhook URL

```bash
curl -X PATCH $API_URL/webhooks/WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://new-url.com/webhook"
  }'
```

### Update webhook events

```bash
curl -X PATCH $API_URL/webhooks/WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "events": ["order.created", "order.updated", "order.completed"]
  }'
```

### Disable a webhook

```bash
curl -X PATCH $API_URL/webhooks/WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "status": "disabled"
  }'
```

### Re-enable a webhook

```bash
curl -X PATCH $API_URL/webhooks/WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -d '{
    "status": "active"
  }'
```

### Delete a webhook

```bash
curl -X DELETE $API_URL/webhooks/WEBHOOK_ID
```

### Retry a failed webhook

```bash
curl -X POST $API_URL/webhooks/WEBHOOK_ID/retry
```

### Get webhook statistics

```bash
curl $API_URL/webhooks/WEBHOOK_ID/stats
```

## Event Triggering

**Note:** All endpoints are secured by Codehooks.io built-in authentication.

### Trigger any custom event

```bash
# IoT sensor event
curl -X POST $API_URL/events/trigger/sensor.temperature \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "sensor_001", "temperature": 72.5, "humidity": 45}'

# Business process event
curl -X POST $API_URL/events/trigger/report.generated \
  -H "Content-Type: application/json" \
  -d '{"reportId": "rpt_2025_01", "type": "monthly", "size": 1024000}'

# Custom workflow event
curl -X POST $API_URL/events/trigger/pipeline.completed \
  -H "Content-Type: application/json" \
  -d '{"pipelineId": "pipe_123", "duration": 305, "status": "success"}'
```

### Trigger a user.created event

```bash
curl -X POST $API_URL/events/trigger/user.created \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "email": "john@example.com",
    "name": "John Doe",
    "createdAt": "2025-01-15T10:30:00Z"
  }'
```

### Trigger an order.created event

```bash
curl -X POST $API_URL/events/trigger/order.created \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "order_456",
    "customerId": "user_123",
    "items": [
      {"productId": "prod_1", "quantity": 2, "price": 29.99},
      {"productId": "prod_2", "quantity": 1, "price": 49.99}
    ],
    "total": 109.97,
    "currency": "usd"
  }'
```

### Trigger a payment.succeeded event

```bash
curl -X POST $API_URL/events/trigger/payment.succeeded \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "pay_789",
    "orderId": "order_456",
    "amount": 109.97,
    "currency": "usd",
    "method": "card",
    "last4": "4242"
  }'
```

### Trigger an order.completed event

```bash
curl -X POST $API_URL/events/trigger/order.completed \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "order_456",
    "completedAt": "2025-01-15T10:45:00Z",
    "status": "completed"
  }'
```

### Trigger a subscription event

```bash
curl -X POST $API_URL/events/trigger/subscription.created \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "sub_999",
    "customerId": "user_123",
    "plan": "premium",
    "price": 29.99,
    "interval": "month",
    "status": "active"
  }'
```

## Complete Workflow Example

### 1. Start test receiver

```bash
# Terminal 1
node test-receiver.js
```

### 2. Expose with ngrok

```bash
# Terminal 2
ngrok http 3000
```

### 3. Register webhook

```bash
# Terminal 3
curl -X POST $API_URL/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://abc123.ngrok.io/webhook",
    "events": ["*"]
  }' | jq .
```

Save the `id` and `secret` from the response.

### 4. Set secret in receiver

```bash
# Terminal 1 (stop and restart with secret)
WEBHOOK_SECRET=whsec_your_secret_here node test-receiver.js
```

### 5. Check webhook status

```bash
curl $API_URL/webhooks/WEBHOOK_ID | jq .
```

Verify `status` is `active`.

### 6. Trigger test events

```bash
# Trigger multiple events
curl -X POST $API_URL/events/trigger/user.created \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_1", "email": "test1@example.com"}'

curl -X POST $API_URL/events/trigger/user.updated \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_1", "name": "John Updated"}'

curl -X POST $API_URL/events/trigger/order.created \
  -H "Content-Type: application/json" \
  -d '{"orderId": "order_1", "userId": "user_1", "total": 99.99}'
```

### 7. Check webhook statistics

```bash
curl $API_URL/webhooks/WEBHOOK_ID/stats | jq .
```

Should show successful deliveries:

```json
{
  "id": "abc123",
  "deliveryCount": 3,
  "consecutiveFailures": 0,
  "lastDeliveryAt": "2025-01-15T10:30:00.000Z",
  "lastDeliveryStatus": "success",
  "status": "active"
}
```

## Testing with webhook.site

Use webhook.site for quick testing without setting up a local receiver:

```bash
# 1. Go to https://webhook.site and copy your unique URL

# 2. Register it
curl -X POST $API_URL/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://webhook.site/your-unique-id",
    "events": ["*"],
    "verificationType": "stripe"
  }'

# 3. Trigger an event
curl -X POST $API_URL/events/trigger/test.event \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from Codehooks!"}'

# 4. Check webhook.site to see the delivery
```

## Using jq for Pretty Output

Install jq for formatted JSON output:

```bash
# macOS
brew install jq

# Ubuntu/Debian
apt-get install jq

# Then pipe curl output through jq
curl $API_URL/webhooks | jq .
```

## Debugging Failed Webhooks

```bash
# Check webhook details
curl $API_URL/webhooks/WEBHOOK_ID | jq '.'

# Check statistics for errors
curl $API_URL/webhooks/WEBHOOK_ID/stats | jq '.'

# Look for lastDeliveryError
curl $API_URL/webhooks/WEBHOOK_ID | jq '.lastDeliveryError'

# Retry the webhook
curl -X POST $API_URL/webhooks/WEBHOOK_ID/retry
```

## Batch Operations

### Register multiple webhooks at once

```bash
# Create webhooks.json
cat > webhooks.json << 'EOF'
[
  {
    "url": "https://service1.com/webhook",
    "events": ["user.created", "user.updated"]
  },
  {
    "url": "https://service2.com/webhook",
    "events": ["order.created", "order.completed"]
  },
  {
    "url": "https://service3.com/webhook",
    "events": ["*"]
  }
]
EOF

# Register them
for webhook in $(jq -c '.[]' webhooks.json); do
  curl -X POST $API_URL/webhooks \
    -H "Content-Type: application/json" \
    -d "$webhook"
  echo ""
done
```

### Trigger multiple events

```bash
# Create events.json
cat > events.json << 'EOF'
[
  {"type": "user.created", "data": {"userId": "user_1"}},
  {"type": "user.updated", "data": {"userId": "user_1"}},
  {"type": "order.created", "data": {"orderId": "order_1"}}
]
EOF

# Trigger them
for event in $(jq -c '.[]' events.json); do
  type=$(echo $event | jq -r '.type')
  data=$(echo $event | jq -c '.data')

  curl -X POST $API_URL/events/trigger/$type \
    -H "Content-Type: application/json" \
    -d "$data"
  echo ""
done
```

## Monitoring Script

Create a simple monitoring script:

```bash
#!/bin/bash
# monitor-webhooks.sh

API_URL="https://your-app.api.codehooks.io/dev"

echo "📊 Webhook Monitoring Dashboard"
echo "================================"
echo ""

# Get all webhooks
webhooks=$(curl -s $API_URL/webhooks)
total=$(echo $webhooks | jq '.count')

echo "Total webhooks: $total"
echo ""

# Show status breakdown
echo "Status breakdown:"
echo $webhooks | jq -r '.webhooks[] | "\(.status): \(._id)"' | sort | uniq -c

echo ""
echo "Recent statistics:"
echo ""

# Show stats for each webhook
for id in $(echo $webhooks | jq -r '.webhooks[]._id'); do
  stats=$(curl -s $API_URL/webhooks/$id/stats)
  status=$(echo $stats | jq -r '.status')
  count=$(echo $stats | jq -r '.deliveryCount')
  failures=$(echo $stats | jq -r '.consecutiveFailures')

  echo "Webhook $id:"
  echo "  Status: $status"
  echo "  Deliveries: $count"
  echo "  Failures: $failures"
  echo ""
done
```

Make it executable and run:

```bash
chmod +x monitor-webhooks.sh
./monitor-webhooks.sh
```

## Environment-Specific URLs

```bash
# Development
export API_URL="https://your-app.api.codehooks.io/dev"

# Staging
export API_URL="https://your-app.api.codehooks.io/staging"

# Production
export API_URL="https://your-app.api.codehooks.io/prod"

# Then use $API_URL in all commands
```
