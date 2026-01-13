# SaaS Metering Webhook System

A production-ready usage metering system for Codehooks.io that captures events, aggregates them over configurable time periods, and delivers results via webhooks. Perfect for SaaS applications that need usage-based billing, API metering, or resource tracking.

## Features

- ✅ **Multi-tenant Event Capturing** - Track usage per customer
- ✅ **Batch Aggregation** - Periodic aggregation of usage data
- ✅ **Flexible Time Periods** - Hourly, daily, weekly, monthly, yearly aggregation
- ✅ **7 Aggregation Operations** - Sum, avg, min, max, count, first, last
- ✅ **Cron-Based Processing** - Automated batch processing every 15 minutes
- ✅ **Calendar-Based Periods** - Billing-friendly periods (e.g., monthly = 1st to last day)
- ✅ **Webhook Delivery** - HMAC-SHA256 signed webhooks for completed periods
- ✅ **Global Configuration** - Single config applies to all customers
- ✅ **Production Ready** - Error handling, retries, fault isolation, logging

## Use Cases

- **API Metering** - Track API calls per customer for usage-based pricing
- **Storage Tracking** - Monitor storage usage with min/max/average metrics
- **Resource Monitoring** - Track compute hours, database queries, bandwidth
- **Billing Systems** - Generate monthly usage reports for invoicing
- **Analytics** - Aggregate user activity, feature usage, performance metrics

## Quick Start

### 1. Deploy to Codehooks.io

```bash
# Create project from template
coho create my-metering-system --template saas-metering-webhook
cd my-metering-system

# Install dependencies
npm install

# Deploy
coho deploy
```

### 2. Create API Token

```bash
# Add an API token for authentication
coho add-token --description "Metering API"

# View your tokens and project info
coho info
```

### 3. Configure Aggregation

Edit the `systemconfig.json` file to define which events to track and how to aggregate them:

```json
{
  "periods": ["daily", "weekly", "monthly"],
  "events": {
    "api.calls": { "op": "sum" },
    "storage.bytes": { "op": "max" },
    "response.time.ms": { "op": "avg" },
    "error.count": { "op": "count" }
  },
  "webhooks": [
    {
      "url": "https://your-system.com/webhooks/metering",
      "secret": "whsec_your_webhook_secret",
      "enabled": true
    }
  ]
}
```

Then redeploy:

```bash
coho deploy
```

### 4. Send Usage Events

```bash
# Track an API call
curl -X POST https://your-project.api.codehooks.io/dev/usage/api.calls \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{
    "customerId": "cust_123",
    "value": 1
  }'

# Track storage usage
curl -X POST https://your-project.api.codehooks.io/dev/usage/storage.bytes \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY" \
  -d '{
    "customerId": "cust_123",
    "value": 1048576,
    "metadata": {
      "fileId": "file_456",
      "type": "document"
    }
  }'
```

### 5. Query Results

```bash
# Get aggregations (completed periods)
curl "https://your-project.api.codehooks.io/dev/aggregations?customerId=cust_123" \
  -H "x-apikey: YOUR_API_KEY"

# Get raw events
curl "https://your-project.api.codehooks.io/dev/events?customerId=cust_123&limit=100" \
  -H "x-apikey: YOUR_API_KEY"
```

## API Reference

### Event Capture

#### POST /usage/:eventType

Capture a usage event. Events are queued for async processing (returns 202 Accepted immediately).

**URL Parameters:**
- `eventType` - Event type (e.g., `api.calls`, `storage.bytes`, `user.signups`)

**Body:**
```json
{
  "customerId": "cust_123",      // Required: Customer identifier
  "value": 1,                     // Required: Numeric value
  "metadata": {                   // Optional: Additional context
    "userId": "user_456",
    "resource": "document"
  }
}
```

**Response: 202 Accepted**
```json
{
  "message": "Event queued for processing",
  "eventType": "api.calls",
  "customerId": "cust_123"
}
```

### Configuration

#### GET /config

Get the current system configuration (loaded from `systemconfig.json`).

**Response:**
```json
{
  "periods": ["daily", "weekly", "monthly"],
  "events": {
    "api.calls": { "op": "sum" },
    "storage.bytes": { "op": "max" },
    "response.time.ms": { "op": "avg" }
  },
  "webhooks": [...]
}
```

#### Updating Configuration

Configuration is **file-based only** - there is no API endpoint to update configuration at runtime. To update the configuration:

1. Edit `systemconfig.json` in your project root
2. Redeploy: `coho deploy`

> **Note:** Configuration updates require redeployment. There are no POST/PUT/DELETE endpoints for config.

**Configuration Format:**
```json
{
  "periods": ["hourly", "daily", "weekly", "monthly", "yearly"],
  "events": {
    "api.calls": { "op": "sum" },
    "storage.bytes": { "op": "max" },
    "response.time": { "op": "avg" },
    "error.count": { "op": "count" },
    "min.latency": { "op": "min" },
    "first.request": { "op": "first" },
    "last.request": { "op": "last" }
  },
  "webhooks": [
    {
      "url": "https://your-system.com/webhook",
      "secret": "whsec_...",
      "enabled": true
    }
  ]
}
```

**Valid Operations:**
- `sum` - Sum all values (for counters, totals)
- `avg` - Average of all values (for metrics like response time)
- `min` - Minimum value (for finding lowest points)
- `max` - Maximum value (for peak usage)
- `count` - Count of events (ignores value field)
- `first` - First value in period (for initial state)
- `last` - Last value in period (for final state)

**Valid Periods:**
- `hourly` - Start to end of hour (00:00:00 to 00:59:59)
- `daily` - Start to end of day (00:00:00 to 23:59:59 UTC)
- `weekly` - Monday to Sunday (ISO 8601)
- `monthly` - 1st to last day of month
- `yearly` - January 1st to December 31st

### Management

#### GET /events

Query raw events.

**Query Parameters:**
- `customerId` - Filter by customer ID
- `eventType` - Filter by event type
- `from` - Start timestamp (ISO 8601)
- `to` - End timestamp (ISO 8601)
- `limit` - Max results (default: 100)

**Response:** (streamed array)
```json
[
  {
    "_id": "evt_...",
    "customerId": "cust_123",
    "eventType": "api.calls",
    "value": 1,
    "metadata": {},
    "receivedAt": "2026-01-12T10:30:00.000Z",
    "processedAt": "2026-01-12T10:30:01.000Z"
  }
]
```

#### GET /aggregations

Query historical aggregated results (completed periods).

**Query Parameters:**
- `customerId` - Filter by customer ID
- `period` - Filter by period type (hourly/daily/weekly/monthly/yearly)
- `from` - Start timestamp (ISO 8601)
- `to` - End timestamp (ISO 8601)
- `limit` - Max results (default: 100)

**Response:** (streamed array)
```json
[
  {
    "_id": "agg_...",
    "customerId": "cust_123",
    "period": "daily",
    "periodStart": "2026-01-12T00:00:00.000Z",
    "periodEnd": "2026-01-12T23:59:59.999Z",
    "timestamp": "2026-01-13T00:15:00.000Z",
    "events": {
      "api.calls": 1543,
      "storage.bytes": 10485760,
      "response.time": 245.5
    },
    "eventCount": 1543,
    "createdAt": "2026-01-13T00:15:00.000Z",
    "webhookStatus": {
      "delivered": true,
      "deliveredAt": "2026-01-13T00:15:05.000Z",
      "attempts": 1
    }
  }
]
```

#### POST /aggregations/trigger

Manually trigger batch aggregation (useful for testing and real-time dashboards).

**Behavior:**
- Creates aggregations for **all periods** (including incomplete ones)
- Queues webhooks **only for completed periods**
- Incomplete periods are aggregated for real-time queries but do not trigger webhooks
- Idempotent: Won't create duplicate aggregations for already-processed periods

**Request:**
```bash
curl -X POST https://your-project.api.codehooks.io/dev/aggregations/trigger \
  -H "x-apikey: YOUR_API_KEY"
```

**Response:**
```json
{
  "message": "Aggregation triggered",
  "aggregationsCreated": 12
}
```

**Use Cases:**
- Testing aggregation logic without waiting for cron
- Generating real-time usage metrics for dashboards
- Forcing immediate aggregation after bulk event imports

**Important Notes:**
- Webhooks are **only sent for completed periods** (periodEnd < now)
- Incomplete periods show in GET /aggregations but won't trigger webhooks until complete
- The cron job (every 15 min) only processes completed periods


## Aggregation Operations Explained

### sum
Adds all event values together. Use for:
- API call counts
- Transaction totals
- Page views
- Any counter

**Example:**
```
Events: [5, 10, 3]
Result: 18
```

### avg
Calculates the average of all values. Use for:
- Response times
- Ratings
- Temperature
- Any metric where average matters

**Example:**
```
Events: [10, 20, 30]
Result: 20
```

### min
Finds the minimum value. Use for:
- Lowest price
- Best response time
- Minimum usage

**Example:**
```
Events: [100, 50, 75]
Result: 50
```

### max
Finds the maximum value. Use for:
- Peak usage
- Highest price
- Maximum concurrent users

**Example:**
```
Events: [100, 200, 150]
Result: 200
```

### count
Counts the number of events (ignores value). Use for:
- Event frequency
- Number of occurrences

**Example:**
```
Events: [1, 999, 42]
Result: 3
```

> **Note: sum vs count**
> While `sum` and `count` may seem similar, they're different:
> - **`sum`** adds up all the `value` fields (5 + 10 + 3 = 18)
> - **`count`** counts how many events occurred (3 events)
>
> For API call tracking where each event has `value: 1`, both give the same result. However:
> - Use **`sum`** when tracking **quantity** (bytes transferred, transaction amounts)
> - Use **`count`** when tracking **frequency** (how many times something happened)

### first
Takes the first value in the period. Use for:
- Initial state
- Starting balance
- Opening price

**Example:**
```
Events: [100, 200, 300]
Result: 100
```

### last
Takes the last value in the period. Use for:
- Final state
- Ending balance
- Closing price

**Example:**
```
Events: [100, 200, 300]
Result: 300
```

## How It Works

### Architecture

```
┌─────────────┐
│  POST       │
│  /usage/*   │  (201 Created - event stored)
└──────┬──────┘
       │
       ▼
┌──────────────┐
│  Events      │
│  Collection  │  ◄─── GET /events (Query raw events)
└──────────────┘
       │
       │ Every 15 min - Cron job runs
       ▼
┌──────────────────┐
│  Cron Job        │
│  Batch           │
│  Aggregation     │
├──────────────────┤
│  For each period:│
│  ├─► Check if    │
│  │   complete    │
│  ├─► Aggregate   │
│  │   events      │
│  └─► Store       │
│      results     │
└──────┬───────────┘
       │
       ├────────────────────┐
       │                    │
       ▼                    ▼
┌──────────────┐    ┌────────────────┐
│  Aggregations│    │  Webhook       │
│  Collection  │    │  Worker        │
│              │    └────────┬───────┘
│              │             │
│              │ ◄─── GET    ▼
│              │ /aggregations
│              │      ┌────────────────┐
└──────────────┘      │  Your System   │
                      │  (receives     │
                      │  completed     │
                      │  aggregation)  │
                      └────────────────┘
```

### Batch Aggregation Flow

**Event Processing:**

1. **API receives event** - POST /usage/:eventType with customer ID and value
2. **Event stored** - Returns 201 Created (event immediately stored in database)
3. **Event indexed** - Event stored with time period fields (hour, day, week, month, year) for fast aggregation

**Batch Aggregation (Automatic - Every 15 minutes):**

The cron job runs **every 15 minutes** (`*/15 * * * *`) to aggregate completed periods:

1. **Find recent events** - Gets list of customers with events in the last hour
2. **For each customer and period type:**
   - Check if period has completed (periodEnd < now)
   - Skip if period not complete or already aggregated
   - Query all events for that customer/period using indexed time fields
   - Apply configured operations (sum, avg, min, max, count, first, last)
   - Store aggregation result in `aggregations` collection
3. **Queue webhook deliveries** - For each completed aggregation, queue webhook worker
4. **Webhooks sent** - Delivered with HMAC-SHA256 signatures

**Manual Aggregation (POST /aggregations/trigger):**

You can manually trigger aggregation for testing or real-time dashboards:

1. **Process all customers** - Aggregates for all customers with events
2. **For each customer and period type:**
   - Create/update aggregation for the period (even if incomplete)
   - **Queue webhooks ONLY for completed periods** (periodEnd < now)
   - Incomplete periods are aggregated for queries but don't trigger webhooks
3. **Use case** - View real-time metrics without waiting for periods to complete

**Important:** Webhooks are **only sent when periods are complete**, regardless of how aggregation is triggered (cron or manual).

**Benefits of Batch Aggregation:**

- **Efficient**: Processes events in bulk using indexed queries
- **Reliable**: Idempotent - won't create duplicate aggregations
- **Flexible**: Supports 7 different aggregation operations
- **Scalable**: Each customer processed independently
- **Accurate**: Aggregates reflect all events in the completed period

**Example Timeline:**
- **10:00:00** - Event arrives and is stored in events collection
- **10:00:05** - Event available via GET /events
- **11:15:00** - Cron job runs, finds completed 10:00-10:59 hourly period
- **11:15:05** - Aggregation created and webhook sent
- **11:15:10** - Historical aggregation available in GET /aggregations

## Webhook Delivery

### Webhook Payload

When an aggregation is completed, registered webhooks receive:

```json
{
  "type": "aggregation.completed",
  "customerId": "cust_123",
  "period": "daily",
  "data": {
    "periodStart": "2026-01-12T00:00:00.000Z",
    "periodEnd": "2026-01-12T23:59:59.999Z",
    "timestamp": "2026-01-13T00:15:00.000Z",
    "events": {
      "api.calls": 1543,
      "storage.bytes": 10485760
    },
    "eventCount": 1543
  },
  "created": 1736726100
}
```

### Webhook Headers

```
Content-Type: application/json
X-Webhook-Signature: v1=<hmac_sha256_signature>
X-Webhook-Timestamp: <unix_timestamp>
User-Agent: Codehooks-Metering/1.0
```

### Signature Verification

Webhooks are signed with HMAC-SHA256. Verify the signature to ensure authenticity:

**Node.js Example:**
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, timestamp, secret) {
  // Reject old requests (> 5 minutes)
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

  // Compare using timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

// Express.js example
app.post('/webhooks/metering', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = parseInt(req.headers['x-webhook-timestamp']);
  const payload = JSON.stringify(req.body);
  const secret = process.env.WEBHOOK_SECRET;

  if (!verifyWebhookSignature(payload, signature, timestamp, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process webhook
  const { type, customerId, period, data } = req.body;
  console.log(`Received ${period} aggregation for ${customerId}`);
  console.log('Events:', data.events);

  res.json({ received: true });
});
```

### Testing Webhooks with DRY_RUN Mode

Use the `DRY_RUN` environment variable to test webhook configurations without actually sending HTTP requests:

```bash
# Enable dry run mode
coho set-env DRY_RUN true
coho deploy

# Now webhooks will be logged but not sent
# Watch the logs to see webhook payloads
coho logs --follow
```

**What happens in DRY_RUN mode:**
- Webhook payload is prepared normally
- HMAC signature is generated
- Full payload and headers are logged to console
- No HTTP request is made
- Aggregation is marked as delivered with `dryRun: true` flag
- Perfect for validating payload format and signatures

**Example log output:**
```
🔵 [Webhook DRY RUN] Would send webhook: {
  url: 'https://your-system.com/webhooks/metering',
  aggregationId: 'cust_123_daily_20260113',
  customerId: 'cust_123',
  period: 'daily',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': 'v1=abc123...',
    'X-Webhook-Timestamp': '1736726100',
    'User-Agent': 'Codehooks-Metering/2.0',
    'Content-Length': 256
  },
  payload: {
    type: 'aggregation.completed',
    customerId: 'cust_123',
    period: 'daily',
    data: {
      periodStart: '2026-01-13T00:00:00.000Z',
      periodEnd: '2026-01-13T23:59:59.999Z',
      events: { 'api.calls': 1543 }
    },
    created: 1736726100
  }
}
✅ [Webhook DRY RUN] Simulated delivery of aggregation cust_123_daily_20260113 to https://...
```

**When to use DRY_RUN:**
- Testing webhook endpoint configurations
- Validating webhook payload structure
- Debugging signature generation
- Development and staging environments
- Before enabling webhooks in production

```bash
# Disable dry run mode when ready for production
coho unset-env DRY_RUN
coho deploy
```

## Examples

### Example 1: API Call Tracking

Track API calls per endpoint and customer:

```javascript
// Configuration
{
  "periods": ["daily", "monthly"],
  "events": {
    "api.endpoint.users": { "op": "sum" },
    "api.endpoint.orders": { "op": "sum" },
    "api.endpoint.products": { "op": "sum" }
  }
}

// Send events
fetch('https://your-project.api.codehooks.io/dev/usage/api.endpoint.users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-apikey': 'YOUR_API_KEY'
  },
  body: JSON.stringify({
    customerId: 'cust_acme',
    value: 1,
    metadata: {
      method: 'GET',
      path: '/api/users',
      status: 200
    }
  })
});

// Result: Daily aggregation shows total API calls per endpoint
{
  "api.endpoint.users": 1543,
  "api.endpoint.orders": 892,
  "api.endpoint.products": 234
}
```

### Example 2: Storage Monitoring

Track storage usage with min/max/avg:

```javascript
// Configuration
{
  "periods": ["hourly", "daily"],
  "events": {
    "storage.used.bytes": { "op": "max" },
    "storage.files.count": { "op": "last" },
    "storage.avg.file.size": { "op": "avg" }
  }
}

// Send storage snapshots every hour
fetch('https://your-project.api.codehooks.io/dev/usage/storage.used.bytes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-apikey': 'YOUR_API_KEY'
  },
  body: JSON.stringify({
    customerId: 'cust_acme',
    value: 10485760  // 10 MB
  })
});

// Result: Daily aggregation shows peak storage usage
{
  "storage.used.bytes": 15728640,  // Peak: 15 MB
  "storage.files.count": 47,        // Final count
  "storage.avg.file.size": 334448   // Avg: ~326 KB
}
```

### Example 3: Performance Metrics

Track response times and errors:

```javascript
// Configuration
{
  "periods": ["daily"],
  "events": {
    "response.time.ms": { "op": "avg" },
    "response.time.min.ms": { "op": "min" },
    "response.time.max.ms": { "op": "max" },
    "errors.5xx": { "op": "count" },
    "errors.4xx": { "op": "count" }
  }
}

// Track each request
async function trackRequest(customerId, responseTime, statusCode) {
  await fetch('https://your-project.api.codehooks.io/dev/usage/response.time.ms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-apikey': 'YOUR_API_KEY'
    },
    body: JSON.stringify({
      customerId,
      value: responseTime
    })
  });

  // Track min/max separately
  await fetch('https://your-project.api.codehooks.io/dev/usage/response.time.min.ms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-apikey': 'YOUR_API_KEY' },
    body: JSON.stringify({ customerId, value: responseTime })
  });

  await fetch('https://your-project.api.codehooks.io/dev/usage/response.time.max.ms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-apikey': 'YOUR_API_KEY' },
    body: JSON.stringify({ customerId, value: responseTime })
  });

  // Track errors
  if (statusCode >= 500) {
    await fetch('https://your-project.api.codehooks.io/dev/usage/errors.5xx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-apikey': 'YOUR_API_KEY' },
      body: JSON.stringify({ customerId, value: 1 })
    });
  }
}

// Result: Daily aggregation shows performance stats
{
  "response.time.ms": 245.5,      // Average
  "response.time.min.ms": 45,     // Fastest
  "response.time.max.ms": 1200,   // Slowest
  "errors.5xx": 3,                // Server errors
  "errors.4xx": 42                // Client errors
}
```

### Example 4: Usage Dashboard with Raw Events

Display current usage metrics by querying raw events:

```javascript
// Build a usage dashboard using raw events
async function displayUsageDashboard(customerId) {
  // Get events for the current month
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const response = await fetch(
    `https://your-project.api.codehooks.io/dev/events?customerId=${customerId}&from=${monthStart.toISOString()}&limit=10000`,
    {
      headers: { 'x-apikey': 'YOUR_API_KEY' }
    }
  );

  const events = await response.json();

  // Aggregate events by type
  const aggregates = {};
  events.forEach(event => {
    if (!aggregates[event.eventType]) {
      aggregates[event.eventType] = { count: 0, sum: 0, values: [] };
    }
    aggregates[event.eventType].count++;
    aggregates[event.eventType].sum += event.value;
    aggregates[event.eventType].values.push(event.value);
  });

  // Display current month usage
  console.log('Current Month Usage:');
  if (aggregates['api.calls']) {
    console.log(`  API Calls: ${aggregates['api.calls'].sum.toLocaleString()}`);
  }
  if (aggregates['storage.bytes']) {
    const maxStorage = Math.max(...aggregates['storage.bytes'].values);
    console.log(`  Storage: ${(maxStorage / 1048576).toFixed(2)} MB`);
  }
  if (aggregates['response.time.ms']) {
    const avgTime = aggregates['response.time.ms'].sum / aggregates['response.time.ms'].count;
    console.log(`  Avg Response Time: ${avgTime.toFixed(2)}ms`);
  }

  // Check against limits
  const API_LIMIT = 100000;
  const apiCalls = aggregates['api.calls']?.sum || 0;
  const usagePercent = (apiCalls / API_LIMIT * 100).toFixed(1);
  console.log(`  Usage: ${usagePercent}% of monthly limit`);

  if (usagePercent > 90) {
    console.log('  ⚠️  Warning: Approaching monthly limit!');
  }
}

// Update dashboard periodically
setInterval(() => displayUsageDashboard('cust_acme'), 60000);

// Example output:
// Current Month Usage:
//   API Calls: 87,543
//   Storage: 245.32 MB
//   Avg Response Time: 156.78ms
//   Usage: 87.5% of monthly limit
```

**Note:**
- For production dashboards, consider implementing server-side caching
- Query completed aggregations via GET /aggregations for historical data
- Set appropriate limit values based on expected event volumes

## Testing

See the `examples/` directory for complete testing scripts.

### Manual Testing

1. Deploy the application
2. Create configuration
3. Send test events
4. Wait for cron job (runs every 15 minutes)
5. Query aggregations

### Quick Test (Hourly Period)

```bash
# 1. Edit systemconfig.json for hourly aggregation
cat > systemconfig.json <<EOF
{
  "periods": ["hourly"],
  "events": {
    "test.metric": {"op": "sum"}
  },
  "webhooks": []
}
EOF

# 2. Deploy
coho deploy

# 3. Send 10 test events
for i in {1..10}; do
  curl -X POST $BASE_URL/usage/test.metric \
    -H "x-apikey: $API_KEY" \
    -d '{"customerId":"test_customer","value":1}'
done

# 4. Query raw events immediately
curl "$BASE_URL/events?customerId=test_customer&limit=20" \
  -H "x-apikey: $API_KEY"

# Should show 10 events with test.metric

# 5. Wait for next hour + 15 minutes for aggregation to complete
curl "$BASE_URL/aggregations?customerId=test_customer" \
  -H "x-apikey: $API_KEY"

# Aggregation created after period completes and cron job runs
```

## Deployment

### Environments

Codehooks supports multiple spaces (environments):

```bash
# Default 'dev' space
coho deploy

# Add production space
coho add prod

# Deploy to production
coho use prod
coho deploy

# Switch back to dev
coho use dev
```

### Environment Variables

No external API keys are required for basic functionality. Optional environment variables:

```bash
# Webhook dry run mode - simulates webhook delivery without actually sending
# Set to 'true' or '1' to enable
DRY_RUN=true

# When DRY_RUN is enabled, webhook payloads are logged but not sent
# Useful for:
# - Testing webhook configurations without hitting external endpoints
# - Validating payload format before going live
# - Development and debugging

# Optional: Email notifications (future enhancement)
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your_key

# Optional: Slack notifications (future enhancement)
SLACK_WEBHOOK_URL=your_webhook
```

**Setting Environment Variables:**

```bash
# Set environment variable for current deployment
coho set-env DRY_RUN true

# View all environment variables
coho info

# Remove environment variable
coho unset-env DRY_RUN
```

## Monitoring

### Key Logs

Monitor these log messages:

**Event Processing:**
- `✅ [API] Event captured: api.calls for cust_456` - Event stored in database

**Batch Aggregation (Every 15 minutes):**
- `🔄 [Cron] Starting batch aggregation...` - Cron job started
- `📊 [Cron] Processing 5 customers` - Number of customers being processed
- `✅ [Cron] Created daily aggregation for cust_456 (20260113)` - Period aggregated
- `📤 [Cron] Queued webhook to https://...` - Webhook queued for completed period
- `✅ [Cron] Completed batch aggregation: 12 aggregations created` - Cron job finished

**Manual Aggregation Trigger:**
- `✅ [Manual] Created hourly aggregation for cust_456 (2026011315)` - Aggregation created
- `📤 [Manual] Queued webhook to https://... for completed period` - Webhook queued for completed period
- `⏭️  [Manual] Skipping webhook for incomplete hourly period (2026011315)` - Webhook not sent (period incomplete)

**Webhook Delivery:**
- `✅ [Webhook] Delivered aggregation agg_123 to https://...` - Webhook delivered successfully
- `🔵 [Webhook DRY RUN] Would send webhook: {...}` - Dry run mode: webhook payload logged but not sent
- `✅ [Webhook DRY RUN] Simulated delivery of aggregation agg_123 to https://...` - Dry run mode: webhook simulated
- `❌ [Webhook] Delivery failed: ...` - Webhook delivery failed (will retry)

**Errors:**
- `❌ [Worker] Error updating daily aggregate for cust_789: ...` - Aggregate update failed (will retry)
- `❌ [Cron] Error finalizing aggregation agg_xyz: ...` - Period finalization failed

### View Logs

```bash
# Follow logs in real-time
coho logs --follow

# View recent logs
coho logs --limit 100
```

### Health Check

```bash
curl https://your-project.api.codehooks.io/dev/
```

Returns service information and API documentation links.

## Troubleshooting

### Events not being aggregated

1. Check if global config exists:
   ```bash
   curl $BASE_URL/config -H "x-apikey: $API_KEY"
   ```

2. Verify events are being stored:
   ```bash
   curl "$BASE_URL/events?limit=10" -H "x-apikey: $API_KEY"
   ```

3. Wait for cron job to run (every 15 minutes)

4. Check logs for errors:
   ```bash
   coho logs --follow
   ```

### Webhooks not being delivered

1. Check webhook configuration in global config
2. Verify webhook URL is accessible
3. Check aggregation `webhookStatus`:
   ```bash
   curl "$BASE_URL/aggregations?customerId=xxx" -H "x-apikey: $API_KEY"
   ```

4. Look for webhook worker errors in logs

### Duplicate aggregations

The system prevents duplicates using the `aggregation_state` collection. If you see duplicates:

1. Check for multiple cron job instances (shouldn't happen)
2. Verify `aggregation_state` documents exist
3. Contact support if issue persists

## Performance

### Scalability

- **Events**: Handles millions of events via queue-based processing
- **Aggregation**: Streaming architecture processes events without loading all into memory
- **Customers**: Scales to thousands of customers (each processed independently)

### Optimization Tips

1. **Use appropriate periods**: Don't aggregate hourly if you only bill monthly
2. **Limit event types**: Only track metrics you need
3. **Archive old events**: Remove events older than your longest period
4. **Monitor queue depth**: Ensure events are being processed quickly

## License

ISC

## Support

- Documentation: See this README
- Issues: Report at [GitHub Issues](https://github.com/anthropics/codehooks-io-templates/issues)
- Community: [Codehooks Discord](https://discord.gg/codehooks)

## Credits

Built with [Codehooks.io](https://codehooks.io) - Serverless backend platform
