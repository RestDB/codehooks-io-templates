# Configuration Examples

This directory includes several example `stepsconfig.json` files for different use cases. Copy and customize the one that best fits your needs.

## Available Examples

### 1. Default Configuration (`stepsconfig.json`)
**Use case:** Standard 3-step welcome series

**Timing:**
- Step 1: 24 hours (1 day)
- Step 2: 96 hours (4 days)
- Step 3: 264 hours (11 days)

**Best for:**
- General welcome campaigns
- Product onboarding
- Newsletter signups

### 2. 5-Step Nurture Campaign (`stepsconfig.5-step.example.json`)
**Use case:** Extended onboarding with feedback collection

**Timing:**
- Step 1: 24 hours (1 day) - Welcome
- Step 2: 72 hours (3 days) - Tips
- Step 3: 168 hours (1 week) - Advanced features
- Step 4: 336 hours (2 weeks) - Feedback request
- Step 5: 720 hours (30 days) - Milestone celebration

**Best for:**
- SaaS product onboarding
- Long-term customer engagement
- Community building

### 3. Course Daily Drip (`stepsconfig.course-daily.example.json`)
**Use case:** Daily course delivery over one week

**Timing:**
- Step 1: 24 hours (Day 1)
- Step 2: 48 hours (Day 2)
- Step 3: 72 hours (Day 3)
- Step 4: 96 hours (Day 4)
- Step 5: 120 hours (Day 5)
- Step 6: 144 hours (Day 6)
- Step 7: 168 hours (Day 7)

**Best for:**
- Email courses
- Educational content
- Training programs
- Challenge series

### 4. Aggressive Onboarding (`stepsconfig.aggressive-onboarding.example.json`)
**Use case:** High-engagement onboarding with fast follow-ups

**Timing:**
- Step 1: 1 hour - Welcome and setup
- Step 2: 4 hours - First quick win
- Step 3: 12 hours - Power user tip
- Step 4: 24 hours - Progress check
- Step 5: 48 hours - Case study
- Step 6: 96 hours - Webinar invitation
- Step 7: 168 hours - One week milestone + offer

**Best for:**
- Free trial conversions
- Product launches
- High-touch sales processes
- Time-sensitive offers

### 5. Testing Configuration (`stepsconfig.testing.example.json`)
**Use case:** Fast testing of workflow functionality

**Timing:**
- Step 1: 0.083 hours (5 minutes)
- Step 2: 0.166 hours (10 minutes)
- Step 3: 0.25 hours (15 minutes)

**Best for:**
- Testing your setup
- Debugging workflow issues
- Demonstrating functionality
- Development/staging environments

⚠️ **Remember to replace with production config before going live!**

## How to Use These Examples

### Option 1: Copy and Rename
```bash
# Copy example to stepsconfig.json
cp stepsconfig.5-step.example.json stepsconfig.json

# Deploy
coho deploy
```

### Option 2: Start from Scratch
```bash
# Backup current config
cp stepsconfig.json stepsconfig.backup.json

# Edit stepsconfig.json with your preferred editor
nano stepsconfig.json

# Deploy changes
coho deploy
```

### Option 3: Customize an Example
```bash
# Copy example to temporary file
cp stepsconfig.course-daily.example.json stepsconfig.custom.json

# Edit the custom file
nano stepsconfig.custom.json

# When ready, replace main config
mv stepsconfig.custom.json stepsconfig.json

# Deploy
coho deploy
```

## Configuration Structure

Every config file follows this structure:

```json
{
  "workflowSteps": [
    {
      "step": 1,
      "hoursAfterSignup": 24,
      "template": {
        "subject": "Email subject line",
        "heading": "Main heading (supports {{name}} placeholder)",
        "body": "Email body text (supports \\n for line breaks)",
        "buttonText": "CTA button text",
        "buttonUrl": "https://example.com/action",
        "logoUrl": "https://example.com/logo.png"
      }
    }
  ]
}
```

### Template Placeholders

Use these placeholders in your templates:
- `{{name}}` - Subscriber's name
- `{{email}}` - Subscriber's email address

### Time Calculations

Hours are calculated from the subscriber's `createdAt` timestamp:
- **1 hour** = 1
- **12 hours** = 12
- **1 day** = 24
- **3 days** = 72
- **1 week** = 168
- **2 weeks** = 336
- **1 month** = 720
- **2 months** = 1440

### Tips for Creating Your Own Config

1. **Start Simple**: Begin with 3-5 steps and expand later
2. **Space Out Messages**: Give subscribers time to engage between emails
3. **Clear CTAs**: Each email should have one primary call-to-action
4. **Progressive Value**: Each email should build on the previous ones
5. **Test First**: Use `stepsconfig.testing.example.json` to verify everything works

## Common Patterns

### Welcome Series (3-5 emails)
Spacing: 1-3 days between emails
Focus: Product education, quick wins, engagement

### Educational Course (5-30 emails)
Spacing: Daily or every other day
Focus: Progressive learning, building skills

### Nurture Campaign (5-10 emails)
Spacing: 1 week to 1 month between emails
Focus: Relationship building, value demonstration

### Trial Conversion (5-7 emails)
Spacing: Hours to days (aggressive)
Focus: Feature highlights, urgency, social proof

## Monitoring Your Configuration

Check your active configuration:
```bash
curl https://your-project.api.codehooks.io/dev/
```

View all templates:
```bash
curl https://your-project.api.codehooks.io/dev/templates \
  -H "x-apikey: YOUR_API_KEY_HERE"
```

## Troubleshooting

### Config Not Loading
1. Verify valid JSON syntax: `cat stepsconfig.json | jq`
2. Check deployment logs: `coho logs --tail 50`
3. Look for config loading message: "✅ Loaded workflow configuration"

### Wrong Templates Showing
1. Verify stepsconfig.json is in the project root
2. Redeploy: `coho deploy`
3. Clear any custom templates in database if needed

### Timing Issues
1. Remember: Hours are decimal (0.5 = 30 minutes)
2. Timing is from `createdAt`, not previous email
3. Cron runs every 15 minutes, so emails may be delayed by up to 15 min

## Need Help?

- [Main README](./README.md) - Full documentation
- [GitHub Issues](https://github.com/codehooks-io/codehooks-io-templates/issues)
- [Codehooks Discord](https://discord.gg/codehooks)
