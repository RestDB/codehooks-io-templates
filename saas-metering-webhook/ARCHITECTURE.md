# SaaS Metering System v2.0 - Architecture

## Overview

This is a **batch-based metering system** that captures usage events and creates periodic aggregations. It uses a simple, reliable approach with manual JavaScript aggregation instead of complex real-time atomic updates.

## Key Design Decisions

### Why Batch-Based?

The previous real-time approach had issues with:
- Race conditions in document initialization
- Complex atomic update logic for different operations
- Codehooks-specific limitations (`$setOnInsert` not supported)
- Difficult to debug and maintain

The batch approach is:
- ✅ Simple and reliable
- ✅ Easy to understand and debug
- ✅ Uses standard JavaScript array operations
- ✅ No race conditions or complex atomic updates
- ✅ Cron-based processing ensures eventual consistency

## System Architecture

### 1. Event Storage

Events are stored immediately with time period indexing:

```javascript
{
  eventType: "api.calls",
  customerId: "cust_123",
  value: 100,
  metadata: {},
  receivedAt: "2026-01-13T08:00:00.000Z",

  // Time period fields for fast querying
  minute: "202601130800",  // YYYYMMDDHHmm
  hour: "2026011308",      // YYYYMMDDHH
  day: "20260113",         // YYYYMMDD
  week: "202603",          // YYYYWW (ISO week)
  month: "202601",         // YYYYMM
  year: "2026"             // YYYY
}
```

**Benefits:**
- Fast querying by period using indexed fields
- No need for complex date range queries
- ISO week calculation for accurate weekly aggregations

### 2. Aggregation Processing

#### Automatic (Cron-based)
- Runs every 15 minutes via `app.job('*/15 * * * *')`
- Finds events within configurable lookback windows:
  - Hourly: 7 days
  - Daily: 30 days
  - Weekly: 60 days
  - Monthly: 90 days
  - Yearly: 365 days
- Groups events by period key and identifies completed periods
- **Only processes completed periods** (periodEnd < now)
- Creates aggregation documents in `aggregations` collection
- Queues webhooks for all completed aggregations
- **Catches up on missed periods** - Processes all completed periods within the lookback window, not just the most recent one

#### Manual (For Testing & Real-time Dashboards)
- Endpoint: `POST /aggregations/trigger`
- **Processes all periods** (including incomplete ones)
- **Webhooks only queued for completed periods** (periodEnd < now)
- Incomplete periods are aggregated but don't trigger webhooks
- Useful for:
  - Testing aggregation logic without waiting for periods to complete
  - Viewing real-time metrics in dashboards via GET /aggregations
  - Forcing immediate aggregation after bulk imports

#### Aggregation Logic

```javascript
// Manual JavaScript aggregation - simple and reliable!
const events = await conn.getMany('events', query).toArray();

switch (op) {
  case 'sum':
    value = events.reduce((sum, e) => sum + e.value, 0);
    break;
  case 'avg':
    value = events.reduce((sum, e) => sum + e.value, 0) / events.length;
    break;
  case 'min':
    value = Math.min(...events.map(e => e.value));
    break;
  case 'max':
    value = Math.max(...events.map(e => e.value));
    break;
  case 'count':
    value = events.length;
    break;
  case 'first':
    // Sort by receivedAt and take first
    break;
  case 'last':
    // Sort by receivedAt and take last
    break;
}
```

### 3. Aggregation Storage

```javascript
{
  _id: "cust_123_daily_20260113",
  customerId: "cust_123",
  period: "daily",
  periodStart: "2026-01-13T00:00:00.000Z",
  periodEnd: "2026-01-13T23:59:59.999Z",
  periodKey: "20260113",
  timestamp: "2026-01-14T00:00:00.000Z",

  events: {
    "api.calls": 1500,      // Sum of all values
    "storage.bytes": 10000, // Max of all values
    "response.time.ms": 125 // Average of all values
  },

  eventCounts: {
    "api.calls": 150,
    "storage.bytes": 150,
    "response.time.ms": 150
  },

  webhookStatus: {
    delivered: false,
    attempts: 0
  }
}
```

### 4. Webhook Delivery

- **Only triggered for completed periods** (periodEnd < now)
- Queue-based async delivery via `conn.enqueue()`
- HMAC-SHA256 signature for security
- Retry logic with attempt tracking
- Delivery status stored in aggregation document
- Works with both cron-triggered and manually-triggered aggregations

## API Endpoints

### Event Capture
```
POST /usage/:eventType
Body: { customerId, value, metadata? }
Response: 201 { message, eventType, customerId }
```

### Query Events
```
GET /events?customerId=xxx&eventType=yyy&from=timestamp&to=timestamp&limit=100
```

### Query Aggregations
```
GET /aggregations?customerId=xxx&period=daily&from=timestamp&to=timestamp&limit=100
```

### Manual Trigger (Testing)
```
POST /aggregations/trigger
Response: { message, aggregationsCreated }
```

### Configuration
```
GET /config
Returns: systemconfig.json contents
```

## Configuration (systemconfig.json)

```json
{
  "periods": ["hourly", "daily", "weekly", "monthly"],
  "events": {
    "api.calls": { "op": "sum" },
    "storage.bytes": { "op": "max" },
    "response.time.ms": { "op": "avg" },
    "test.min": { "op": "min" },
    "test.count": { "op": "count" },
    "test.first": { "op": "first" },
    "test.last": { "op": "last" }
  },
  "webhooks": [
    {
      "enabled": true,
      "url": "https://your-webhook.com/metering",
      "secret": "your_webhook_secret"
    }
  ]
}
```

## Testing

Run the comprehensive aggregation test suite to verify all operators:

```bash
# Set environment variables
export BASE_URL="https://your-project.api.codehooks.io/dev"
export API_KEY="your_api_key"

# Run tests
node test-aggregation.js
```

The test script:
1. Drops `events` and `aggregations` collections
2. Posts known test data for each operator
3. Triggers aggregation manually
4. Verifies results against expected values
5. Runs edge case tests (negative values, decimals, zeros)

## Current Status

### ✅ Working
- Event storage with time period fields
- Manual JavaScript aggregation (sum, avg, min, max, count, first, last)
- Cron job execution every 15 minutes
- Batch processing logic with lookback windows
- Webhook delivery worker with HMAC signing
- Configuration system (file-based)

## Performance Considerations

### Indexing Strategy

Create indexes on frequently queried fields:

```javascript
// In Codehooks dashboard or via API
{
  "events": {
    "customerId": 1,
    "eventType": 1,
    "day": 1
  },
  "aggregations": {
    "customerId": 1,
    "period": 1,
    "periodStart": -1
  }
}
```

### Scaling

For high-volume scenarios:

1. **Event Storage**: Events scale linearly - consider retention policies
2. **Aggregation**: Batch processing scales well, with configurable lookback windows:
   - Hourly: 7 days (processes last 168 completed hours)
   - Daily: 30 days (processes last 30 completed days)
   - Weekly: 60 days (processes last ~8 completed weeks)
   - Monthly: 90 days (processes last 3 completed months)
   - Adjust these values in code if needed for your use case
   - Processing customers in parallel (if Codehooks supports)
   - Archiving old events after aggregation

3. **Webhook Delivery**: Queue-based with retry - scales well

## Future Enhancements

1. **Real-time Dashboard**: WebSocket endpoint for live metrics
2. **Data Retention**: Auto-archive events older than X days
3. **Custom Periods**: Support for custom billing cycles
4. **Alerts**: Threshold-based notifications
5. **Analytics**: Trend analysis and forecasting

## Migration from v1.0

The v1.0 (real-time atomic update) approach had fundamental issues. V2.0 is a complete rewrite with:
- Simpler architecture
- More reliable aggregation
- Better testability
- Easier maintenance

No migration path needed - just redeploy and start fresh.
