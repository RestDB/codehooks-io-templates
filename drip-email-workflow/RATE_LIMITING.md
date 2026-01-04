# Rate Limiting Feature

The drip email template now includes intelligent rate limiting to prevent hitting email provider limits and overwhelming their APIs.

## How It Works

### Three-Layer Protection

1. **Cron Job - Batch Limiting**
   - Only queues a maximum number of emails per run (default: 25 per 15 minutes)
   - Checks hourly send count before queueing
   - Stops queueing if rate limit reached

2. **Database - Rolling Window Tracking**
   - Tracks actual sends per hour in `email_rate_tracking` collection
   - Prevents over-queueing before hitting limits
   - Auto-increments on successful sends

3. **Worker - Exponential Backoff**
   - Detects 429 (rate limit) errors from email providers
   - Retries with increasing delays: 5min → 15min → 30min
   - Keeps email marked as sent during retry (prevents duplicate queue entries)
   - Removes from sent list only after 3 failed retries

## Configuration

Set these environment variables based on your email provider plan:

```bash
# Provider-specific rate limits (emails per hour)
coho set-env SENDGRID_RATE_LIMIT "100"
coho set-env MAILGUN_RATE_LIMIT "100"
coho set-env POSTMARK_RATE_LIMIT "100"

# Max emails to queue per 15-minute cron run
# Formula: rate_limit / 4 (since cron runs 4 times per hour)
coho set-env MAX_EMAILS_PER_CRON_RUN "25"
```

### Common Provider Limits

**SendGrid:**
- Free tier: 100 emails/day
- Essentials: 100 emails/hour (plan dependent)

**Mailgun:**
- Trial/Free: 100 emails/hour
- Paid plans: Higher limits

**Postmark:**
- Free tier: 100 emails/month
- Paid plans: Based on your plan

## Monitoring

### Check Current Rate Limit Status

```bash
curl https://your-project.api.codehooks.io/dev/rate-limit-status \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

Response:
```json
{
  "provider": "sendgrid",
  "rateLimit": 100,
  "currentHour": "2025-01-15T14:00:00.000Z",
  "sentThisHour": 47,
  "remaining": 53,
  "percentUsed": 47,
  "status": "ok"
}
```

### Check System Health

```bash
curl https://your-project.api.codehooks.io/dev/
```

Shows rate limiting configuration:
```json
{
  "status": "ok",
  "rateLimiting": {
    "enabled": true,
    "rateLimit": 100,
    "maxPerCronRun": 25
  }
}
```

## Log Messages

### Normal Operation

```
📊 [Cron] Rate limit: 47/100 sent this hour, queueing up to 25 emails
✅ [Cron] Step 1: Checked 30 subscribers, queued 20 emails
✅ [Cron] Batch complete: Queued 20/25 emails
```

### Rate Limit Reached

```
⚠️ [Cron] Rate limit reached: 100/100 sent this hour. Skipping queue.
```

### 429 Error with Retry

```
❌ [Worker] Error sending email: 429 - Rate limit exceeded
⏰ [Worker] Rate limit hit, retrying user@example.com in 5 minutes (attempt 1/3)
```

### Successful Retry

```
📨 [Worker] Processing email for user@example.com, step 1 (retry 1/3)
✅ [Worker] Step 1 email sent to user@example.com
```

## Database Schema

### email_rate_tracking Collection

```javascript
{
  _id: "rate_tracker_2025_01_15_14",  // Hour-specific key
  provider: "sendgrid",
  hour: "2025-01-15T14:00:00.000Z",
  sentCount: 47,
  createdAt: "2025-01-15T14:00:00.000Z",
  updatedAt: "2025-01-15T14:23:15.000Z"
}
```

Records are automatically cleaned up after 2 days (daily cleanup job at 2 AM).

## Email Log Updates

The `email_log` collection now includes retry information:

```javascript
{
  _id: "...",
  subscriberId: "...",
  email: "user@example.com",
  step: 1,
  success: false,
  error: "Rate limit - will retry in 5 min",
  retryCount: 0,
  willRetry: true,  // Indicates if retry is scheduled
  sentAt: "2025-01-15T14:23:15.000Z"
}
```

## Behavior Examples

### Example 1: Normal Load

- Cron runs at 14:00, finds 20 subscribers ready
- Rate tracker shows 50/100 sent this hour
- Queues all 20 emails (under limit)
- Workers send successfully, tracker updates to 70/100

### Example 2: At Rate Limit

- Cron runs at 14:15, finds 30 subscribers ready
- Rate tracker shows 100/100 sent this hour
- Skips queueing entirely
- Logs: "Rate limit reached: 100/100 sent this hour"
- Next cron run (14:30) still skips
- At 15:00 (new hour), rate resets to 0/100, queues resume

### Example 3: 429 Error During Send

- Worker sends email, provider returns 429
- Worker schedules retry in 5 minutes
- Email stays in `emailsSent` array (prevents duplicate queue)
- After 5 minutes, worker retries
- If still 429, retries after 15 minutes
- If still 429, retries after 30 minutes
- After 3 failed retries, removes from `emailsSent` for cron retry

## Adjusting for Your Plan

### High Volume Plan (e.g., 1000 emails/hour)

```bash
coho set-env SENDGRID_RATE_LIMIT "1000"
coho set-env MAX_EMAILS_PER_CRON_RUN "250"
```

### Low Volume Plan (e.g., 50 emails/hour)

```bash
coho set-env SENDGRID_RATE_LIMIT "50"
coho set-env MAX_EMAILS_PER_CRON_RUN "12"
```

### Different Cron Frequency

If you change the cron frequency from 15 minutes:

```javascript
// Every 5 minutes
app.job('*/5 * * * *', ...)
// Set: MAX_EMAILS_PER_CRON_RUN = rate_limit / 12

// Every 30 minutes
app.job('*/30 * * * *', ...)
// Set: MAX_EMAILS_PER_CRON_RUN = rate_limit / 2
```

## Benefits

✅ **Prevents API overload** - Never exceeds provider rate limits
✅ **Graceful degradation** - Emails delayed, not lost
✅ **Automatic retry** - 429 errors handled with exponential backoff
✅ **Transparent monitoring** - Real-time status via API
✅ **Provider-agnostic** - Works with any email provider
✅ **No lost emails** - Everything eventually gets sent
✅ **Cost optimization** - Prevents wasted API calls

## Troubleshooting

### Emails queuing slowly?

Check rate limit status:
```bash
curl https://your-project.api.codehooks.io/dev/rate-limit-status \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

If hitting limit, either:
1. Increase your provider plan
2. Spread sends over more time (decrease `MAX_EMAILS_PER_CRON_RUN`)

### Seeing many 429 errors?

Your `RATE_LIMIT` might be set too high for your actual provider plan. Lower it:

```bash
coho set-env SENDGRID_RATE_LIMIT "50"  # Reduce from 100
```

### Want to disable rate limiting?

Set very high limits:

```bash
coho set-env EMAIL_RATE_LIMIT "10000"
coho set-env MAX_EMAILS_PER_CRON_RUN "1000"
```

Note: Not recommended, as you'll still hit provider limits.
