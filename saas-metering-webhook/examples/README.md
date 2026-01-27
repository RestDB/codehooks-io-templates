# Examples

This directory contains example scripts for testing and working with the SaaS Metering Webhook System.

## generate-events.js

Generates random, valid events for testing the metering system.

### Features

- Generates approximately 100 events per run (configurable)
- Distributes events across three test customers: `customer_1`, `customer_2`, `customer_3`
- Creates realistic events for all configured event types:
  - `api.calls` - API call tracking with HTTP metadata
  - `storage.bytes` - Storage usage with file type metadata
  - `response.time.ms` - Response time metrics with endpoint metadata
- Provides detailed statistics and summaries
- No external dependencies (uses Node 18+ native fetch)

### Usage

```bash
# Basic usage
BASE_URL=https://your-project.api.codehooks.io/dev \
API_KEY=your_api_key \
node examples/generate-events.js

# Generate 200 events instead of 100
BASE_URL=https://your-project.api.codehooks.io/dev \
API_KEY=your_api_key \
EVENT_COUNT=200 \
node examples/generate-events.js

# Add delay between events (useful for testing real-time aggregation)
BASE_URL=https://your-project.api.codehooks.io/dev \
API_KEY=your_api_key \
DELAY_MS=100 \
node examples/generate-events.js
```

### Environment Variables

- `BASE_URL` - **(Required)** Base URL of your metering API
- `API_KEY` - **(Required)** API key for authentication
- `EVENT_COUNT` - *(Optional)* Number of events to generate (default: 100)
- `DELAY_MS` - *(Optional)* Delay between events in milliseconds (default: 0)

### Example Output

```
🚀 Event Generator
═══════════════════════════════════════════════════
Base URL:      https://your-project.api.codehooks.io/dev
API Key:       ***ab12
Event Count:   100
Delay:         0ms
Customers:     customer_1, customer_2, customer_3
Event Types:   api.calls, storage.bytes, response.time.ms
═══════════════════════════════════════════════════

Generating 100 events...

✅ [1/100] api.calls for customer_2 (value: 1)
✅ [2/100] storage.bytes for customer_1 (value: 45.32 MB)
✅ [3/100] response.time.ms for customer_3 (value: 156)
...

═══════════════════════════════════════════════════
📊 Summary
═══════════════════════════════════════════════════
Total Events:  100
Success:       100 ✅
Failed:        0 ❌
Duration:      2.34s
Rate:          42.74 events/sec

By Customer:
  customer_1: 35 (35.0%)
  customer_2: 32 (32.0%)
  customer_3: 33 (33.0%)

By Event Type:
  api.calls: 34 (34.0%)
  storage.bytes: 33 (33.0%)
  response.time.ms: 33 (33.0%)
═══════════════════════════════════════════════════
```

### Testing Workflow

1. **Generate events**:
   ```bash
   BASE_URL=https://your-project.api.codehooks.io/dev \
   API_KEY=your_api_key \
   node examples/generate-events.js
   ```

2. **Verify events were stored**:
   ```bash
   curl "https://your-project.api.codehooks.io/dev/events?limit=10" \
     -H "x-apikey: your_api_key"
   ```

3. **Trigger aggregation manually** (for testing):
   ```bash
   # Returns 202 Accepted - processing happens asynchronously via workers
   curl -X POST https://your-project.api.codehooks.io/dev/aggregations/trigger \
     -H "x-apikey: your_api_key"
   ```

4. **Wait a few seconds for workers to process**, then **check aggregations**:
   ```bash
   curl "https://your-project.api.codehooks.io/dev/aggregations?limit=10" \
     -H "x-apikey: your_api_key"
   ```

## webhook-receiver.js

Example webhook receiver that verifies HMAC signatures and processes aggregation webhooks.

### Features

- HMAC-SHA256 signature verification
- Timestamp validation (rejects requests > 5 minutes old)
- Example processing logic for billing, alerting, and analytics
- Express.js based server

### Installation

```bash
npm install express
```

### Usage

```bash
# Start the webhook receiver
WEBHOOK_SECRET=your_webhook_secret node examples/webhook-receiver.js

# Or with custom port
PORT=8080 WEBHOOK_SECRET=your_webhook_secret node examples/webhook-receiver.js
```

### Configuration

Update your `systemconfig.json` to point to the webhook receiver:

```json
{
  "webhooks": [
    {
      "url": "http://localhost:3000/webhooks/metering",
      "secret": "your_webhook_secret",
      "enabled": true
    }
  ]
}
```

Then redeploy:

```bash
coho deploy
```

### Example Output

```
🚀 Webhook Receiver Started
════════════════════════════════════════
Listening on: http://localhost:3000
Webhook URL: http://localhost:3000/webhooks/metering
Webhook Secret: your_webhook_secret
════════════════════════════════════════

Waiting for webhooks...

📨 Received webhook
─────────────────────────────────────────
✅ Signature verified

Webhook Type: aggregation.completed
Customer ID: customer_1
Period: daily

Period Range:
  Start: 2026-01-14T00:00:00.000Z
  End:   2026-01-14T23:59:59.999Z
  Timestamp: 2026-01-15T00:05:00.000Z

Aggregated Events:
  api.calls: 542
  storage.bytes: 104857600
  response.time.ms: 234.5

Total Events Processed: 542
─────────────────────────────────────────

💡 Processing daily aggregation for customer_1
   💰 Billing: 542 API calls = $0.54
   📊 Analytics: Slow response time (234.50ms avg)
```

## Tips

### Testing Hourly Aggregation

To test hourly aggregation quickly:

1. Update `systemconfig.json` to only include hourly periods:
   ```json
   {
     "periods": ["hourly"],
     ...
   }
   ```

2. Deploy: `coho deploy`

3. Generate events: `node examples/generate-events.js`

4. Wait for the next hour + 5 minutes for the cron job to run

5. Or trigger manually: `POST /aggregations/trigger`

### Testing with DRY_RUN Mode

To test webhooks without actually sending them:

```bash
# Enable dry run mode
coho set-env DRY_RUN true
coho deploy

# Generate events and trigger aggregation
node examples/generate-events.js
curl -X POST $BASE_URL/aggregations/trigger -H "x-apikey: $API_KEY"

# Watch logs to see webhook payloads
coho logs --follow

# Disable dry run when ready
coho unset-env DRY_RUN
coho deploy
```

### Load Testing

To test with larger volumes:

```bash
# Generate 10,000 events (uses single-event endpoint, no batch limit)
EVENT_COUNT=10000 node examples/generate-events.js

# Or run multiple generators in parallel
for i in {1..10}; do
  EVENT_COUNT=1000 node examples/generate-events.js &
done
wait
```

**Note:** The `/usagebatch` endpoint has a **1000 event limit** per request. The batch generator (`generate-batchevents.js`) automatically handles this by splitting larger batches into multiple requests.

### Response Codes

The API uses these HTTP status codes:

| Code | Meaning |
|------|---------|
| 201  | Events captured successfully |
| 202  | Aggregation jobs queued (async processing) |
| 207  | Partial success (some events failed) |
| 400  | Bad request (missing body, not array) |
| 413  | Batch too large (> 1000 events) |
| 422  | Validation failed (invalid event data) |
| 503  | Service misconfigured (no event types) |
