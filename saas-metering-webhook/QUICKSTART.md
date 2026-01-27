# Quick Start

Get the SaaS Metering System running in 5 minutes.

## 1. Deploy

```bash
# Create project from template
coho create my-metering --template saas-metering-webhook
cd my-metering

# Install and deploy
npm install
coho deploy
```

## 2. Get Your API Key

```bash
coho add-token
coho info
```

Save the API key and endpoint URL shown.

## 3. Configure Events

Edit `systemconfig.json`:

```json
{
  "periods": ["hourly", "daily", "monthly"],
  "events": {
    "api.calls": { "op": "sum" },
    "storage.bytes": { "op": "max" }
  },
  "webhooks": []
}
```

Redeploy: `coho deploy`

## 4. Send Events

```bash
# Single event
curl -X POST https://YOUR-PROJECT.api.codehooks.io/dev/usage/api.calls \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{"customerId": "cust_123", "value": 1}'

# Batch events (up to 1000)
curl -X POST https://YOUR-PROJECT.api.codehooks.io/dev/usagebatch \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '[
    {"eventType": "api.calls", "customerId": "cust_123", "value": 1},
    {"eventType": "storage.bytes", "customerId": "cust_123", "value": 5000}
  ]'
```

## 5. View Results

```bash
# Check events
curl "https://YOUR-PROJECT.api.codehooks.io/dev/events?customerId=cust_123" \
  -H "x-apikey: YOUR_API_KEY"

# Trigger aggregation (for testing)
curl -X POST https://YOUR-PROJECT.api.codehooks.io/dev/aggregations/trigger \
  -H "x-apikey: YOUR_API_KEY"

# View aggregations
curl "https://YOUR-PROJECT.api.codehooks.io/dev/aggregations?customerId=cust_123" \
  -H "x-apikey: YOUR_API_KEY"
```

## 6. Monitor

```bash
coho logs --follow
```

## Aggregation Operations

| Operation | Use Case |
|-----------|----------|
| `sum` | Totals (API calls, transactions) |
| `avg` | Averages (response time) |
| `min` | Minimum values |
| `max` | Peak usage (storage) |
| `count` | Event frequency |
| `first` | Initial value in period |
| `last` | Final value in period |

## What's Next?

- Add webhooks to receive aggregation results
- See [README.md](README.md) for full API documentation
- See [ARCHITECTURE.md](ARCHITECTURE.md) for system design
