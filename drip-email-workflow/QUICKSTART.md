# Quick Start Guide - Drip Email Workflow

Get your drip email campaign running in under 5 minutes!

## 1. Deploy the Template

```bash
coho create my-drip-campaign --template drip-email-workflow
cd my-drip-campaign
npm install
coho deploy
```

Your API is now live at: `https://YOUR_PROJECT.api.codehooks.io/dev/`

Check it's working:
```bash
curl https://YOUR_PROJECT.api.codehooks.io/dev/
```

## 2. Set Up Email Provider

### Option A: SendGrid (Easiest)

1. Sign up at https://sendgrid.com (free tier: 100 emails/day)
2. Verify your sender email
3. Create API key: Settings → API Keys → Create API Key (Full Access)
4. Configure:

```bash
coho set-env EMAIL_PROVIDER "sendgrid"
coho set-env SENDGRID_API_KEY "SG.your-key-here"
coho set-env FROM_EMAIL "your-verified-email@domain.com"
coho set-env FROM_NAME "Your Company Name"
```

### Option B: Mailgun

1. Sign up at https://mailgun.com (free tier: 5,000 emails/month)
2. Verify your domain
3. Get API key: Settings → API Security
4. Configure:

```bash
coho set-env EMAIL_PROVIDER "mailgun"
coho set-env MAILGUN_API_KEY "your-key-here"
coho set-env MAILGUN_DOMAIN "mg.yourdomain.com"
coho set-env FROM_EMAIL "noreply@yourdomain.com"
coho set-env FROM_NAME "Your Company Name"
```

## 3. Configure Workflow (Optional)

The default `stepsconfig.json` has 3 steps: 1 day, 4 days, and 11 days after signup.

To customize, edit `stepsconfig.json`:

```json
{
  "workflowSteps": [
    {
      "step": 1,
      "hoursAfterSignup": 24,
      "template": {
        "subject": "Welcome! 🎉",
        "heading": "Hi {{name}}!",
        "body": "Thanks for signing up!",
        "buttonText": "Get Started",
        "buttonUrl": "https://example.com",
        "logoUrl": "https://example.com/logo.png"
      }
    }
  ]
}
```

Or use a pre-made example:

```bash
# 5-step nurture campaign
cp stepsconfig.5-step.example.json stepsconfig.json

# Daily course delivery
cp stepsconfig.course-daily.example.json stepsconfig.json

# Aggressive onboarding
cp stepsconfig.aggressive-onboarding.example.json stepsconfig.json
```

Then redeploy:
```bash
coho deploy
```

## 4. Add a Test Subscriber

Add yourself as a test subscriber:

```bash
curl -X POST https://YOUR_PROJECT.api.codehooks.io/dev/subscribers \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY_HERE" \
  -d '{
    "name": "Your Name",
    "email": "your-email@example.com"
  }'
```

That's it! The cron job runs every 15 minutes and will automatically process subscribers.

## 5. Verify It's Working

Check subscriber status:

```bash
curl https://YOUR_PROJECT.api.codehooks.io/dev/subscribers
```

Monitor logs:

```bash
coho logs --follow
```

Look for these messages every 15 minutes:
- `🔄 [Cron] Starting drip email batch processing...`
- `📧 [Cron] Step 1: Found X subscribers ready`
- `✅ [Cron] Step 1: Queued X emails`
- `📨 [Worker] Processing email for your-email@example.com, step 1`
- `✅ [Worker] Step 1 email sent to your-email@example.com`

## Quick Testing

### Option 1: Dry Run Mode (Recommended for Initial Testing)

Test the entire workflow without sending actual emails:

```bash
# Enable dry run mode
coho set-env DRY_RUN "true"

# Add a test subscriber
curl -X POST https://YOUR_PROJECT.api.codehooks.io/dev/subscribers \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com"}'

# Watch logs - you'll see emails logged but not sent
coho logs --follow
```

Look for:
```
⚠️ DRY RUN MODE ENABLED - Emails will be logged but not sent
📧 [DRY RUN] Would send email:
   To: test@example.com
   Subject: Welcome to Our Community! 🎉
```

**Turn off dry run when ready:**
```bash
coho set-env DRY_RUN "false"
```

### Option 2: Fast Delivery (Test Actual Email Sending)

Want to test actual email sending without waiting hours? Use the fast testing config:

```bash
# Backup your current config
cp stepsconfig.json stepsconfig.backup.json

# Use fast testing config (5min, 10min, 15min intervals)
cp stepsconfig.testing.example.json stepsconfig.json

# Deploy
coho deploy

# Add a test subscriber
curl -X POST https://YOUR_PROJECT.api.codehooks.io/dev/subscribers \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com"}'

# Watch logs
coho logs --follow
```

You should see emails queued within 15 minutes (next cron run).

**Remember to restore your production config after testing!**

```bash
cp stepsconfig.backup.json stepsconfig.json
coho deploy
```

### Pro Tip: Combine Both Methods

Use dry run mode with fast testing config to verify workflow logic quickly:

```bash
# Enable dry run
coho set-env DRY_RUN "true"

# Use fast config
cp stepsconfig.testing.example.json stepsconfig.json
coho deploy

# Test and verify logs
# Then restore and disable dry run
cp stepsconfig.backup.json stepsconfig.json
coho set-env DRY_RUN "false"
coho deploy
```

## Next Steps

### Customize Your Email Templates

**Option 1: Edit stepsconfig.json (Recommended)**

Templates are defined in `stepsconfig.json`. Edit the file and redeploy:

```bash
nano stepsconfig.json  # Edit your templates
coho deploy       # Deploy changes
```

**Option 2: Override via API (Advanced)**

View current templates:
```bash
curl https://YOUR_PROJECT.api.codehooks.io/dev/templates -H "x-apikey: YOUR_API_KEY_HERE"
```

Create a custom template override:
```bash
curl -X POST https://YOUR_PROJECT.api.codehooks.io/dev/templates \
  -H "Content-Type: application/json" \
  -H "x-apikey: YOUR_API_KEY_HERE" \
  -d '{
    "step": 1,
    "subject": "🎉 Welcome to Our Community!",
    "heading": "Hi {{name}}, welcome aboard!",
    "body": "We are thrilled to have you join us!\n\nHere is what you can expect...",
    "buttonText": "Get Started",
    "buttonUrl": "https://yoursite.com/dashboard",
    "logoUrl": "https://yoursite.com/logo.png"
  }'
```

Note: API overrides take precedence over stepsconfig.json templates.

### Add More Subscribers

You can add subscribers via:
- Direct API calls (as shown above)
- Integrate with your signup form
- Import from CSV (write a script to POST each subscriber)

### Set Up API Token for Unsubscribe

```bash
# Create an API token
coho add-token --description "Unsubscribe API"

# Use it in unsubscribe requests
curl -X POST https://YOUR_PROJECT.api.codehooks.io/dev/subscribers/abc123/unsubscribe \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

## Troubleshooting

### Emails not sending?

1. Check environment variables:
   ```bash
   coho env list
   ```

2. Verify your email provider credentials are correct

3. Check logs for errors:
   ```bash
   coho logs --tail 50
   ```

4. Verify the cron job is running (look for logs every 15 minutes)

### Need help?

- Read the full [README.md](README.md)
- See [CONFIG-EXAMPLES.md](CONFIG-EXAMPLES.md) for workflow examples
- Check [Codehooks.io docs](https://codehooks.io/docs)
- Join [Codehooks Discord](https://discord.gg/codehooks)

## Common Commands

```bash
# View all subscribers
curl https://YOUR_PROJECT.api.codehooks.io/dev/subscribers -H "x-apikey: YOUR_API_KEY_HERE" \

# View only subscribed users
curl https://YOUR_PROJECT.api.codehooks.io/dev/subscribers?subscribed=true -H "x-apikey: YOUR_API_KEY_HERE" \

# Check health/configuration
curl https://YOUR_PROJECT.api.codehooks.io/dev/ -H "x-apikey: YOUR_API_KEY_HERE" \

# View logs
coho logs --follow

# List environment variables
coho info

# Update an environment variable
coho set-env VARIABLE_NAME "value"

# Redeploy after changes
coho deploy
```

That's it! Your drip email campaign is now running. 🚀
