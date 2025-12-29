# Drip Email Workflow - Codehooks.io Template

A simple, production-ready drip email campaign system with **dynamic step configuration**. Add as many email steps as you want - configure everything in one `stepsconfig.json` file.

Easy to understand, easy to customize, infinitely scalable.

## Features

- ✅ **Dynamic Step Configuration** - Add unlimited steps via `stepsconfig.json`
- ✅ **Integrated Email Templates** - Templates defined alongside workflow steps
- ✅ **Single Cron Job** - One intelligent batch processor for all steps
- ✅ **Time-Based Scheduling** - Each step runs X hours after signup
- ✅ **Queue-Based Delivery** - Reliable background processing with `conn.enqueue()`
- ✅ **Dual Email Providers** - SendGrid and Mailgun REST API integration
- ✅ **Prevents Duplicates** - Each subscriber receives each email only once
- ✅ **Subscriber Management** - Full CRUD API
- ✅ **Professional Design** - Beautiful, responsive emails

## Email Preview

Here's what your subscribers will receive:

![Email Template Preview](./email-preview.png)

The template features a modern, responsive design with a purple gradient header, personalized content, and clear call-to-action buttons.

## How It Works

**Simple architecture with config file-based configuration:**

```
┌──────────────────────────────────────────────────────┐
│  stepsconfig.json                                    │
│  {                                                   │
│    "workflowSteps": [                                │
│      {                                               │
│        "step": 1,                                    │
│        "hoursAfterSignup": 24,                       │
│        "template": { subject, heading, body, ... }   │
│      },                                              │
│      { ... more steps ... }                          │
│    ]                                                 │
│  }                                                   │
└─────────────────────┬────────────────────────────────┘
                      │ Loaded on startup
                      ▼
┌──────────────────────────────────────────────────────┐
│  SINGLE CRON JOB (runs every 15 min)                 │
│                                                      │
│  For each step in config:                            │
│    1. Calculate cutoff: now - hoursAfterSignup       │
│    2. Find subscribers who:                          │
│       - Haven't received this step                   │
│       - Signed up before cutoff                      │
│    3. Queue them for sending                         │
└─────────────────────┬────────────────────────────────┘
                      │ conn.enqueue('send-email', {...})
                      ▼
┌──────────────────────────────────────────────────────┐
│  QUEUE WORKER                                        │
│  • Sends email via API                               │
│  • Updates subscriber.emailsSent array               │
│  • Marks step complete                               │
└──────────────────────────────────────────────────────┘
```

### Example Configuration

The default `stepsconfig.json` defines a 3-step workflow:

```json
{
  "workflowSteps": [
    {
      "step": 1,
      "hoursAfterSignup": 24,
      "template": {
        "subject": "Welcome to Our Community! 🎉",
        "heading": "Welcome, {{name}}!",
        "body": "Thank you for joining...",
        "buttonText": "Get Started",
        "buttonUrl": "https://example.com/get-started"
      }
    },
    {
      "step": 2,
      "hoursAfterSignup": 96,
      "template": { ... }
    },
    {
      "step": 3,
      "hoursAfterSignup": 264,
      "template": { ... }
    }
  ]
}
```

**Add more steps** by editing `stepsconfig.json` and redeploying. The single cron job automatically processes all configured steps!

## Quick Start

### 1. Deploy

```bash
coho create my-drip-campaign --template drip-email-workflow
cd my-drip-campaign
npm install
coho deploy
```

### 2. Configure Email Provider

**SendGrid:**
```bash
coho set-env EMAIL_PROVIDER "sendgrid"
coho set-env SENDGRID_API_KEY "SG.your-api-key"
coho set-env FROM_EMAIL "noreply@yourdomain.com"
coho set-env FROM_NAME "Your Company"
```

**Mailgun:**
```bash
coho set-env EMAIL_PROVIDER "mailgun"
coho set-env MAILGUN_API_KEY "your-api-key"
coho set-env MAILGUN_DOMAIN "yourdomain.com"
coho set-env FROM_EMAIL "noreply@yourdomain.com"
coho set-env FROM_NAME "Your Company"
```

### 3. Customize Workflow Steps (Optional)

Default is 3 steps. To customize, edit `stepsconfig.json`:

```json
{
  "workflowSteps": [
    {
      "step": 1,
      "hoursAfterSignup": 24,
      "template": {
        "subject": "Your custom subject",
        "heading": "Hello {{name}}!",
        "body": "Your email content here...",
        "buttonText": "Click Here",
        "buttonUrl": "https://example.com",
        "logoUrl": "https://example.com/logo.png"
      }
    },
    {
      "step": 2,
      "hoursAfterSignup": 72,
      "template": { ... }
    }
  ]
}
```

Then redeploy:
```bash
coho deploy
```

### 4. Add Subscribers

```bash
curl -X POST https://your-project.api.codehooks.io/dev/subscribers \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY_HERE" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com"
  }'
```

That's it! The cron job runs every 15 minutes and processes all steps automatically.

**Get your API key:**
```bash
coho add-token --description "Drip campaign"
```

Use this API key in the `x-apikey` header for all API requests.

## Configuration Examples

This template includes ready-to-use example configurations. See [CONFIG-EXAMPLES.md](./CONFIG-EXAMPLES.md) for detailed documentation.

### Available Examples

**Standard 3-Step (Default)** - `stepsconfig.json`
```bash
# Already active - 1 day, 4 days, 11 days
```

**5-Step Nurture Campaign** - `stepsconfig.5-step.example.json`
```bash
cp stepsconfig.5-step.example.json stepsconfig.json
# Day 1, Day 3, Week 1, Week 2, Month 1
```

**Daily Course Drip** - `stepsconfig.course-daily.example.json`
```bash
cp stepsconfig.course-daily.example.json stepsconfig.json
# 7 daily emails for educational content
```

**Aggressive Onboarding** - `stepsconfig.aggressive-onboarding.example.json`
```bash
cp stepsconfig.aggressive-onboarding.example.json stepsconfig.json
# 1hr, 4hrs, 12hrs, 1d, 2d, 4d, 1w
```

**Fast Testing** - `stepsconfig.testing.example.json`
```bash
cp stepsconfig.testing.example.json stepsconfig.json
# 5min, 10min, 15min intervals for testing
```

After copying, deploy:
```bash
coho deploy
```

For full configuration options and custom examples, see [CONFIG-EXAMPLES.md](./CONFIG-EXAMPLES.md).

## How the Single Cron Job Works

The stepsconfig.json file is loaded at startup using ES module imports:

```javascript
import workflowConfig from './stepsconfig.json' assert { type: 'json' };

// Runs every 15 minutes
app.job('*/15 * * * *', async (req, res) => {
  const workflowSteps = workflowConfig.workflowSteps;

  // Check each step and stream subscribers ready for that step
  for (const stepConfig of workflowSteps) {
    const { step, hoursAfterSignup } = stepConfig;
    const cutoffTime = new Date(now - hoursAfterSignup * 60 * 60 * 1000);

    // Stream subscribers ready for this step (memory efficient)
    const cursor = conn.getMany('subscribers', {
      subscribed: true,
      createdAt: { $lte: cutoffTime }
    });

    await cursor.forEach(async (subscriber) => {
      // Check if subscriber hasn't received this step yet
      if (!subscriber.emailsSent || !subscriber.emailsSent.includes(step)) {
        // Atomically mark as sent and queue
        await conn.updateOne(
          'subscribers',
          { _id: subscriber._id, emailsSent: { $nin: [step] } },
          { $push: { emailsSent: step } }
        );
        await conn.enqueue('send-email', {
          subscriberId: subscriber._id,
          step: step
        });
      }
    });
  }
});
```

**Key Insights:**

1. **Streaming architecture**: Uses `cursor.forEach()` instead of `toArray()` for memory efficiency:
   - Processes subscribers one at a time rather than loading all into memory
   - Scales to millions of subscribers without memory issues
   - Based on [Codehooks streaming data pattern](https://codehooks.io/docs/nosql-database-api#streaming-data-code-example)

2. **Time-based scheduling**: Each step is checked independently based on `createdAt` timestamp:
   - Step 1 sends to everyone who signed up 24+ hours ago (and hasn't received step 1)
   - Step 2 sends to everyone who signed up 96+ hours ago (and hasn't received step 2)
   - Step 5 sends to everyone who signed up 720+ hours ago (and hasn't received step 5)

3. **Race condition prevention**: The cron job atomically marks steps as sent BEFORE queueing:
   - Uses `$nin` (not in) query to ensure step isn't already marked
   - Only queues if the database update succeeds
   - Prevents duplicate queue entries even if cron runs overlap

4. **Automatic retry on failure**: If email sending fails:
   - Worker removes the step from `emailsSent` array
   - Next cron run will detect and re-queue the subscriber
   - Ensures no emails are lost due to temporary failures

## API Reference

### Create Subscriber
```bash
curl -X POST https://your-project.api.codehooks.io/dev/subscribers \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY_HERE" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com"
  }'
```

### List Subscribers
```bash
curl https://your-project.api.codehooks.io/dev/subscribers?subscribed=true \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

Response shows which steps each subscriber has received:
```json
{
  "subscribers": [
    {
      "id": "abc123",
      "email": "john@example.com",
      "emailsSent": [1, 2, 3],  // Received steps 1, 2, 3
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
```

### Get Subscriber Details
```bash
curl https://your-project.api.codehooks.io/dev/subscribers/:id \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

### Unsubscribe
```bash
curl -X POST https://your-project.api.codehooks.io/dev/subscribers/:id/unsubscribe \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

### Get Templates
```bash
curl https://your-project.api.codehooks.io/dev/templates \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

Returns default templates for all configured steps.

### Create/Update Template
```bash
curl -X POST https://your-project.api.codehooks.io/dev/templates \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY_HERE" \
  -d '{
    "step": 1,
    "subject": "Welcome! 🎉",
    "heading": "Hi {{name}}, welcome!",
    "body": "We are excited to have you...",
    "buttonText": "Get Started",
    "buttonUrl": "https://example.com",
    "logoUrl": "https://example.com/logo.png"
  }'
```

**Placeholders:** `{{name}}`, `{{email}}`

### Health Check
```bash
curl https://your-project.api.codehooks.io/dev/
```

Shows current workflow configuration:
```json
{
  "status": "ok",
  "version": "4.0.0",
  "configuration": {
    "workflowSteps": [
      { "step": 1, "hoursAfterSignup": 24 },
      { "step": 2, "hoursAfterSignup": 96 },
      { "step": 3, "hoursAfterSignup": 264 }
    ]
  }
}
```

## Database Schema

### Subscribers Collection

```javascript
{
  _id: "abc123",
  name: "John Doe",
  email: "john@example.com",
  subscribed: true,
  createdAt: "2025-01-15T10:00:00.000Z",  // Used to calculate readiness
  updatedAt: "2025-01-15T10:00:00.000Z",
  emailsSent: [1, 2, 3]  // Which steps completed
}
```

### Templates Collection

```javascript
{
  _id: "def456",
  step: 1,
  subject: "Welcome! 🎉",
  heading: "Welcome, {{name}}!",
  body: "Thank you for joining...",
  buttonText: "Get Started",
  buttonUrl: "https://example.com",
  logoUrl: "https://example.com/logo.png",
  createdAt: "2025-01-15T10:00:00.000Z",
  updatedAt: "2025-01-15T10:00:00.000Z"
}
```

## Template System

Templates are defined in `stepsconfig.json` with full customization options:

```json
{
  "step": 1,
  "hoursAfterSignup": 24,
  "template": {
    "subject": "Email subject line",
    "heading": "Main heading with {{name}} placeholder",
    "body": "Email body text (supports \\n for line breaks)",
    "buttonText": "Call to Action",
    "buttonUrl": "https://example.com/action",
    "logoUrl": "https://example.com/logo.png"
  }
}
```

**Template Placeholders:**
- `{{name}}` - Subscriber's name
- `{{email}}` - Subscriber's email

**Default Templates:**
The default `stepsconfig.json` includes 3 templates:
1. **Step 1**: "Welcome to Our Community! 🎉"
2. **Step 2**: "Quick Tips to Get You Started 💡"
3. **Step 3**: "We'd Love to Hear From You! 💬"

**Overriding Templates:**
You can override config templates at runtime via the `/templates` API for advanced use cases.

## Monitoring

### Check Configuration
```bash
curl https://your-project.api.codehooks.io/dev/
```

### View Subscriber Progress
```bash
curl https://your-project.api.codehooks.io/dev/subscribers \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

Look at `emailsSent` array to see which steps completed.

### View Logs
```bash
coho logs --follow
```

**Common log messages:**
- `🔄 [Cron] Checking 50 subscribers against 5 steps`
- `📧 [Cron] Step 3: Found 5 subscribers ready (264h after signup)`
- `✅ [Cron] Step 3: Queued 5 emails`
- `✅ [Cron] Batch complete: Queued 15 total emails`
- `📨 [Worker] Processing email for john@example.com, step 3`
- `✅ [Worker] Step 3 email sent to john@example.com`

## Testing

### Dry Run Mode (No Emails Sent)

Test the entire workflow without sending actual emails:

```bash
# Enable dry run mode
coho set-env DRY_RUN "true"

# Add test subscribers and watch logs
coho logs --follow
```

In dry run mode:
- All workflow logic executes normally
- Subscribers are marked as having received emails
- Queue workers process jobs
- **No actual emails are sent** - only logged

Look for these log messages:
```
⚠️ DRY RUN MODE ENABLED - Emails will be logged but not sent
📧 [DRY RUN] Would send email:
   To: test@example.com
   Subject: Welcome to Our Community! 🎉
   HTML length: 2847 characters
   Provider: sendgrid
   From: Your Company <noreply@example.com>
```

**Disable dry run mode:**
```bash
coho set-env DRY_RUN "false"
# or remove it entirely
coho remove-env DRY_RUN
```

### Quick Test (5-minute intervals)

Edit `stepsconfig.json` for fast testing:

```json
{
  "workflowSteps": [
    { "step": 1, "hoursAfterSignup": 0.083, "template": { ... } },  // 5min
    { "step": 2, "hoursAfterSignup": 0.166, "template": { ... } },  // 10min
    { "step": 3, "hoursAfterSignup": 0.25, "template": { ... } }    // 15min
  ]
}
```

Deploy and add a test subscriber:
```bash
coho deploy
curl -X POST https://your-project.api.codehooks.io/dev/subscribers \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY_HERE" \
  -d '{"name":"Test User","email":"test@example.com"}'
```

Watch logs:
```bash
coho logs --follow
```

You should see emails queued within 15 minutes (next cron run).

**Reset stepsconfig.json to production values after testing!**

## Email Provider Setup

### SendGrid
1. Sign up at https://sendgrid.com (free: 100 emails/day)
2. Verify sender email
3. Create API key: Settings → API Keys
4. Configure: `coho set-env SENDGRID_API_KEY "SG.your-key"`

### Mailgun
1. Sign up at https://mailgun.com (free: 5,000 emails/month)
2. Verify domain
3. Get API key: Settings → API Security
4. Configure: `coho set-env MAILGUN_API_KEY "your-key"`

## Customization

### Change Cron Frequency

Default is every 15 minutes. To run more/less frequently, edit `index.js`:

```javascript
// Every 5 minutes (more responsive)
app.job('*/5 * * * *', async (req, res) => { ... });

// Every hour (less load)
app.job('0 * * * *', async (req, res) => { ... });
```

### Skip Weekends

**Option 1: Cron Expression (Recommended)**

Use a cron expression to only run on weekdays:

```javascript
// Every 15 minutes, Monday-Friday only
app.job('*/15 * * * 1-5', async (req, res) => {
  // ... your logic
});
```

**Option 2: Conditional Logic**

Add logic to check the day:

```javascript
app.job('*/15 * * * *', async (req, res) => {
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log('Weekend - skipping');
    return res.end();
  }
  // ... rest of logic
});
```

**Cron expression reference:**
- `*/15 * * * *` - Every 15 minutes, every day
- `*/15 * * * 1-5` - Every 15 minutes, Monday-Friday only
- `*/15 9-17 * * 1-5` - Every 15 minutes, 9 AM-5 PM, weekdays only
- `0 9 * * 1-5` - Once at 9 AM, weekdays only

### Customize Email HTML

The email template is in a separate file for easy customization:

**Edit `email-template.js`:**

```javascript
export function generateEmailTemplate({
  subject,
  heading,
  body,
  buttonText,
  buttonUrl,
  logoUrl,
  fromName
}) {
  return `
<!DOCTYPE html>
<html>
  <!-- Customize HTML structure and CSS here -->
  ...
</html>
  `.trim();
}
```

Changes you can make:
- Modify CSS styles (colors, fonts, layout)
- Change HTML structure
- Add additional sections or elements
- Update gradient colors (currently purple gradient)
- Customize responsive breakpoints

After editing, redeploy:
```bash
coho deploy
```

### Add More Workflow Steps

Simply edit `stepsconfig.json` and add more step objects:

```json
{
  "workflowSteps": [
    { "step": 1, "hoursAfterSignup": 24, "template": { ... } },
    { "step": 2, "hoursAfterSignup": 96, "template": { ... } },
    { "step": 3, "hoursAfterSignup": 264, "template": { ... } },
    { "step": 4, "hoursAfterSignup": 720, "template": { ... } },
    { "step": 5, "hoursAfterSignup": 1440, "template": { ... } }
  ]
}
```

Then redeploy:
```bash
coho deploy
```

No code changes needed!

## Troubleshooting

### Emails Not Sending
1. Check env vars: `coho env list`
2. Verify API keys are active
3. Check logs: `coho logs --tail 50`
4. Test email provider directly

### Steps Not Processing
1. Check workflow config: `curl https://your-project.api.codehooks.io/dev/`
2. Verify cron is running (look for logs every 15 min)
3. Check if enough time has passed since `createdAt`
4. Verify subscriber is `subscribed: true`

### Wrong Number of Steps
The number of steps is configured in `stepsconfig.json`. Check your configuration:
```bash
curl https://your-project.api.codehooks.io/dev/
```

To change, edit `stepsconfig.json` and redeploy:
```bash
coho deploy
```

## Scaling

- **100 subscribers**: Works perfectly with default config
- **1,000 subscribers**: No changes needed, streaming handles this easily
- **10,000 subscribers**: Still efficient with streaming architecture
- **100,000+ subscribers**:
  - Monitor email provider rate limits
  - Consider running cron less frequently (every 30-60 min)
  - Add database indexes on `subscribed` and `createdAt` fields
  - Monitor queue processing times

The architecture scales extremely well because:
- **Streaming data processing**: Constant memory usage regardless of subscriber count
- **Single cron job**: Efficient time-based logic
- **Queue-based delivery**: Handles parallel processing automatically
- **No in-memory arrays**: Uses cursor.forEach() to process one record at a time
- **Simple state management**: Only tracks which steps have been sent

## Production Considerations

### Email Deliverability
- Verify domain with SPF and DKIM
- Start small, gradually increase volume
- Monitor bounce rates
- Include unsubscribe link (already in templates)

### Security
- Never commit API keys
- Use API tokens for unsubscribe
- Validate email addresses (basic validation included)

### Compliance
- **GDPR**: Easy unsubscribe provided
- **CAN-SPAM**: Include physical address in footer
- **CASL**: Obtain explicit consent

## Resources

- [Codehooks.io Documentation](https://codehooks.io/docs)
- [Codehooks Cron Jobs](https://codehooks.io/docs/cron-jobs)
- [Codehooks Queue Hooks](https://codehooks.io/docs/queuehooks)
- [SendGrid API](https://docs.sendgrid.com/api-reference)
- [Mailgun API](https://documentation.mailgun.com/en/latest/api-intro.html)

## Support

- [GitHub Issues](https://github.com/codehooks-io/codehooks-io-templates/issues)
- [Codehooks Discord](https://discord.gg/codehooks)

## License

MIT

---

**Why This Architecture?**

✅ **Simple**: One cron job, one queue worker, one config file
✅ **Flexible**: Unlimited steps via `stepsconfig.json`
✅ **Integrated**: Templates and timing in one place
✅ **Intelligent**: Automatic time-based scheduling
✅ **Scalable**: Streaming architecture handles millions of subscribers with constant memory usage
✅ **Reliable**: Queue retries, duplicate prevention
✅ **Maintainable**: Easy to understand and debug

Perfect for drip campaigns, onboarding sequences, course delivery, and automated email marketing!
