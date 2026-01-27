# SaaS Metering System v3.0 - Architecture

## Overview

This is a **queue-based metering system** that captures usage events and creates periodic aggregations using distributed workers. It uses `enqueueFromQuery` for scalable bulk job processing with distributed locking for idempotency.

## Key Design Decisions

### Why Queue-Based?

The previous batch approach had scalability issues:
- Loading all events into memory with `.toArray()`
- Sequential processing of customers
- No parallelism or fault tolerance
- Lookback windows required repeated processing of same data

The queue-based approach is:
- ✅ **Scalable**: Uses `enqueueFromQuery` for server-side bulk enqueueing
- ✅ **Memory-efficient**: Streams events with field projection
- ✅ **Parallel**: Worker processes jobs concurrently
- ✅ **Idempotent**: Distributed locking prevents duplicate processing
- ✅ **Fault-tolerant**: Failed jobs can be retried
- ✅ **Observable**: Job records track processing state

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

### 2. Job Creation & Enqueueing

#### Job Records (`pending_agg_jobs` collection)

```javascript
{
  _id: "cust_123_daily_20260113",  // Deterministic ID for dedup
  customerId: "cust_123",
  periodType: "daily",
  periodKey: "20260113",
  periodStart: "2026-01-13T00:00:00.000Z",
  periodEnd: "2026-01-13T23:59:59.999Z",
  status: "pending",  // pending → queued → (removed after processing)
  createdAt: "2026-01-14T00:15:00.000Z",
  source: "cron"  // or "trigger"
}
```

#### Automatic (Cron-based)
- Runs every 15 minutes via `app.job('*/15 * * * *')`
- Calculates **previous completed period** using `calculateCompletedPeriodBounds()`:
  - Hourly: previous hour (e.g., at 11:15, processes 10:00-10:59)
  - Daily: yesterday
  - Weekly: last week (Monday-Sunday)
  - Monthly: last month
- Streams events with field projection to find unique customers (memory-efficient)
- Creates job records with upsert (prevents duplicates)
- Uses `enqueueFromQuery` for ultra-fast bulk enqueueing
- Marks jobs as "queued" after enqueueing

#### Manual (For Testing & Real-time Dashboards)
- Endpoint: `POST /aggregations/trigger`
- Returns **202 Accepted** (async processing)
- **Processes all periods** (including current/incomplete ones)
- Uses same queue-based architecture as cron
- **Webhooks only queued for completed periods** (periodEnd < now)

### 3. Worker Processing (`process-aggregation-job`)

#### Distributed Locking

```javascript
const lockKey = `agg_lock_${aggregationId}`;

// Check for existing lock
const existingLock = await conn.get(lockKey, { keyspace: 'aggregation-locks' });
if (existingLock) {
  console.log('Skipping - already being processed');
  return res.end();
}

// Acquire lock with 2-minute TTL
await conn.set(lockKey, now.toISOString(), {
  keyspace: 'aggregation-locks',
  ttl: 2 * 60 * 1000
});

// ... process aggregation ...

// Release lock
await conn.del(lockKey, { keyspace: 'aggregation-locks' });
```

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
    // Sort by receivedAt ascending and take first
    break;
  case 'last':
    // Sort by receivedAt descending and take first
    break;
}
```

#### Worker Flow

1. Extract job details from payload (comes from `enqueueFromQuery`)
2. Acquire distributed lock (skip if already held)
3. Check if completed period already aggregated (skip if so)
4. Aggregate each event type using configured operation
5. Insert or update aggregation document
6. Queue webhook delivery (only for completed periods)
7. Release lock and remove job record

### 4. Aggregation Storage

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

### 5. Webhook Delivery

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
Response: 422 { error, details } (validation errors)
Response: 503 { error } (no event types configured)
```

### Batch Event Capture
```
POST /usagebatch
Body: [{ eventType, customerId, value, metadata? }, ...]
Limit: 1000 events max
Response: 201 { message, count }
Response: 207 { message, successCount, failedCount } (partial success)
Response: 413 { error, received, maxAllowed } (batch too large)
Response: 422 { error, validationErrors, validCount, invalidCount }
Response: 503 { error } (no event types configured)
```

### Query Events
```
GET /events?customerId=xxx&eventType=yyy&from=timestamp&to=timestamp&limit=100
```

### Query Aggregations
```
GET /aggregations?customerId=xxx&period=daily&from=timestamp&to=timestamp&limit=100
```

### Manual Trigger (Queue-based)
```
POST /aggregations/trigger
Response: 202 { message, jobsCreated, jobsUpdated, jobsQueued, customersFound, periodsConfigured, eventsScanned }
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
- Enhanced input validation with proper HTTP status codes (422, 413, 503, 207)
- Batch event capture with 1000 event limit
- Queue-based aggregation using `enqueueFromQuery`
- Worker-based processing with distributed locking
- Cron job processes only completed periods (previous hour/day/week/month)
- Manual JavaScript aggregation (sum, avg, min, max, count, first, last)
- Webhook delivery worker with HMAC signing
- Configuration system (file-based)

### Collections Used
- `events` - Raw usage events with time period indexing
- `aggregations` - Completed aggregations with webhook status
- `pending_agg_jobs` - Job tracking for queue-based processing

### Key-Value Stores
- `aggregation-locks` keyspace - Distributed locks with 2-minute TTL

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
2. **Job Enqueueing**: Uses `enqueueFromQuery` for server-side bulk enqueueing (ultra-fast, handles thousands of jobs)
3. **Worker Processing**:
   - Distributed locking prevents duplicate processing
   - Jobs processed independently (can be parallelized)
   - Failed jobs can be retried
4. **Memory Efficiency**:
   - Streams events with field projection instead of loading all into memory
   - Job records cleaned up after processing
5. **Webhook Delivery**: Queue-based with retry - scales well

## Future Enhancements

1. **Real-time Dashboard**: WebSocket endpoint for live metrics
2. **Data Retention**: Auto-archive events older than X days
3. **Custom Periods**: Support for custom billing cycles
4. **Alerts**: Threshold-based notifications
5. **Analytics**: Trend analysis and forecasting

## Migration from v2.0

The v2.0 (synchronous batch processing) approach had scalability limitations. V3.0 improves with:
- Queue-based processing using `enqueueFromQuery`
- Worker-based aggregation with distributed locking
- Memory-efficient streaming instead of loading all events
- Cron processes only the previous completed period (no lookback windows)
- Enhanced validation with proper HTTP status codes (422, 413, 503, 207)
- Batch size limit (1000 events)

**Migration steps:**
1. Deploy the new version
2. The new `pending_agg_jobs` collection will be created automatically
3. Existing aggregations remain intact
4. Old lookback-based aggregations won't re-run (cron now processes only previous period)
