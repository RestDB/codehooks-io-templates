# API Usage Examples

Complete examples for using the Drip Email Workflow API.

## Setup

Replace `YOUR_PROJECT` with your actual Codehooks project name:

```bash
export API_URL="https://YOUR_PROJECT.api.codehooks.io/dev"
```

For endpoints requiring authentication:

```bash
export API_KEY="your-api-key-here"
```

## Subscriber Management

### Create a Single Subscriber

```bash
curl -X POST $API_URL/subscribers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice Johnson",
    "email": "alice@example.com"
  }'
```

Response:
```json
{
  "id": "65a1b2c3d4e5f6a7b8c9d0e1",
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "subscribed": true,
  "message": "Subscriber created successfully"
}
```

### Create Multiple Subscribers (Bash Script)

```bash
#!/bin/bash
API_URL="https://YOUR_PROJECT.api.codehooks.io/dev"

subscribers=(
  '{"name":"Alice Johnson","email":"alice@example.com"}'
  '{"name":"Bob Smith","email":"bob@example.com"}'
  '{"name":"Carol Williams","email":"carol@example.com"}'
)

for subscriber in "${subscribers[@]}"; do
  echo "Adding subscriber: $subscriber"
  curl -X POST $API_URL/subscribers \
    -H "Content-Type: application/json" \
    -d "$subscriber"
  echo ""
done
```

### List All Subscribers

```bash
curl $API_URL/subscribers
```

### List Only Subscribed Users

```bash
curl "$API_URL/subscribers?subscribed=true"
```

### Get Specific Subscriber

```bash
# Replace SUBSCRIBER_ID with actual ID
curl $API_URL/subscribers/SUBSCRIBER_ID
```

### Unsubscribe a User

```bash
# Requires API key authentication
curl -X POST $API_URL/subscribers/SUBSCRIBER_ID/unsubscribe \
  -H "x-apikey: $API_KEY"
```

## Email Templates

> **Note:** The workflow runs automatically via a cron job every 15 minutes. When you add subscribers, they are automatically processed based on their signup time and the `hoursAfterSignup` configuration in `stepsconfig.json`. No manual workflow trigger is needed.

### View All Templates

```bash
curl $API_URL/templates
```

### Create/Update Step 1 Template

```bash
curl -X POST $API_URL/templates \
  -H "Content-Type: application/json" \
  -d '{
    "step": 1,
    "subject": "🎉 Welcome to Our Community!",
    "heading": "Welcome, {{name}}!",
    "body": "Thank you for joining our community!\n\nWe are excited to have you here. Over the next few weeks, we will be sharing valuable insights and tips to help you get the most out of our service.\n\nStay tuned for more updates!",
    "buttonText": "Get Started",
    "buttonUrl": "https://example.com/get-started",
    "logoUrl": "https://example.com/logo.png"
  }'
```

### Create/Update Step 2 Template

```bash
curl -X POST $API_URL/templates \
  -H "Content-Type: application/json" \
  -d '{
    "step": 2,
    "subject": "💡 Quick Tips to Get You Started",
    "heading": "Here are some tips, {{name}}",
    "body": "We hope you have had a chance to explore!\n\nHere are some quick tips to help you make the most of your experience:\n\n• Tip 1: Customize your profile\n• Tip 2: Connect with other members\n• Tip 3: Explore our resources\n\nIf you have any questions, feel free to reach out!",
    "buttonText": "View Resources",
    "buttonUrl": "https://example.com/resources",
    "logoUrl": "https://example.com/logo.png"
  }'
```

### Create/Update Step 3 Template

```bash
curl -X POST $API_URL/templates \
  -H "Content-Type: application/json" \
  -d '{
    "step": 3,
    "subject": "💬 We would Love to Hear From You!",
    "heading": "Your Feedback Matters, {{name}}",
    "body": "It has been a pleasure having you in our community!\n\nWe would love to hear about your experience so far. Your feedback helps us improve and serve you better.\n\nTake a moment to share your thoughts with us.",
    "buttonText": "Share Feedback",
    "buttonUrl": "https://example.com/feedback",
    "logoUrl": "https://example.com/logo.png"
  }'
```

### Update Just the Logo URL

```bash
curl -X POST $API_URL/templates \
  -H "Content-Type: application/json" \
  -d '{
    "step": 1,
    "subject": "🎉 Welcome to Our Community!",
    "heading": "Welcome, {{name}}!",
    "body": "Thank you for joining...",
    "buttonText": "Get Started",
    "buttonUrl": "https://example.com/get-started",
    "logoUrl": "https://yourdomain.com/new-logo.png"
  }'
```

## Complete Workflow Example

Here's a complete script to set up and test the workflow:

```bash
#!/bin/bash

# Configuration
API_URL="https://YOUR_PROJECT.api.codehooks.io/dev"

echo "========================================="
echo "Drip Email Workflow - Complete Example"
echo "========================================="

# 1. Add test subscribers
echo ""
echo "1. Adding test subscribers..."
curl -X POST $API_URL/subscribers \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User 1","email":"test1@example.com"}'

curl -X POST $API_URL/subscribers \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User 2","email":"test2@example.com"}'

# 2. List all subscribers
echo ""
echo ""
echo "2. Listing all subscribers..."
curl $API_URL/subscribers

# 3. Check templates
echo ""
echo ""
echo "3. Checking email templates..."
curl $API_URL/templates

echo ""
echo ""
echo "========================================="
echo "Setup complete!"
echo "The workflow runs automatically every 15 minutes"
echo "Check logs with: coho logs --follow"
echo "========================================="
```

## Node.js/JavaScript Integration

### Add Subscriber from Your Application

```javascript
async function addSubscriber(name, email) {
  const response = await fetch('https://YOUR_PROJECT.api.codehooks.io/dev/subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name, email })
  });

  if (!response.ok) {
    throw new Error(`Failed to add subscriber: ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Subscriber added:', data);
  return data;
}

// Usage
addSubscriber('John Doe', 'john@example.com')
  .then(result => console.log('Success:', result))
  .catch(error => console.error('Error:', error));
```

> **Note:** Once a subscriber is added, the cron job will automatically process them every 15 minutes based on their signup time and the workflow configuration.

### Unsubscribe User

```javascript
async function unsubscribeUser(subscriberId, apiKey) {
  const response = await fetch(
    `https://YOUR_PROJECT.api.codehooks.io/dev/subscribers/${subscriberId}/unsubscribe`,
    {
      method: 'POST',
      headers: {
        'x-apikey': apiKey
      }
    }
  );

  const data = await response.json();
  console.log('Unsubscribe result:', data);
  return data;
}

// Usage
const API_KEY = 'your-api-key-here';
unsubscribeUser('65a1b2c3d4e5f6a7b8c9d0e1', API_KEY)
  .then(result => console.log('Success:', result))
  .catch(error => console.error('Error:', error));
```

## Python Integration

### Add Subscriber

```python
import requests

API_URL = "https://YOUR_PROJECT.api.codehooks.io/dev"

def add_subscriber(name, email):
    response = requests.post(
        f"{API_URL}/subscribers",
        json={"name": name, "email": email}
    )
    response.raise_for_status()
    return response.json()

# Usage
result = add_subscriber("Jane Doe", "jane@example.com")
print("Subscriber added:", result)
```

> **Note:** Once a subscriber is added, the cron job will automatically process them every 15 minutes based on their signup time and the workflow configuration.

### Unsubscribe User

```python
import requests

API_URL = "https://YOUR_PROJECT.api.codehooks.io/dev"
API_KEY = "your-api-key-here"

def unsubscribe_user(subscriber_id):
    response = requests.post(
        f"{API_URL}/subscribers/{subscriber_id}/unsubscribe",
        headers={"x-apikey": API_KEY}
    )
    response.raise_for_status()
    return response.json()

# Usage
result = unsubscribe_user("65a1b2c3d4e5f6a7b8c9d0e1")
print("Unsubscribed:", result)
```

## Testing & Monitoring

### Check System Health

```bash
curl $API_URL/
```

### Monitor Workflow Progress

```bash
# Check subscriber status
curl $API_URL/subscribers | jq '.subscribers[] | {email, workflowStatus, emailsSent}'

# View logs
coho logs --tail 50

# Follow logs in real-time
coho logs --follow
```

### Test Email Delivery Quickly

For quick testing, use the fast testing configuration:

```bash
# Backup your current config
cp stepsconfig.json stepsconfig.backup.json

# Use fast testing config (5min, 10min, 15min intervals)
cp stepsconfig.testing.example.json stepsconfig.json

# Deploy
coho deploy

# Add test subscriber
curl -X POST $API_URL/subscribers \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com"}'

# Watch logs - emails will be queued within 15 minutes
coho logs --follow
```

**Remember to restore your production config after testing:**

```bash
cp stepsconfig.backup.json stepsconfig.json
coho deploy
```

Or use dry run mode to test without sending emails:

```bash
coho set-env DRY_RUN "true"
# Test your workflow, then disable:
coho set-env DRY_RUN "false"
```

## Bulk Import from CSV

### CSV Format

Create a file `subscribers.csv`:

```csv
name,email
Alice Johnson,alice@example.com
Bob Smith,bob@example.com
Carol Williams,carol@example.com
```

### Import Script (Bash)

```bash
#!/bin/bash
API_URL="https://YOUR_PROJECT.api.codehooks.io/dev"

tail -n +2 subscribers.csv | while IFS=, read -r name email; do
  echo "Adding: $name ($email)"
  curl -X POST $API_URL/subscribers \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\"}"
  echo ""
done
```

### Import Script (Python)

```python
import csv
import requests

API_URL = "https://YOUR_PROJECT.api.codehooks.io/dev"

with open('subscribers.csv', 'r') as file:
    reader = csv.DictReader(file)
    for row in reader:
        print(f"Adding: {row['name']} ({row['email']})")
        response = requests.post(
            f"{API_URL}/subscribers",
            json={"name": row['name'], "email": row['email']}
        )
        if response.ok:
            print(f"✓ Added successfully")
        else:
            print(f"✗ Failed: {response.text}")
```

## Advanced Usage

### Webhook Integration

Create a webhook endpoint in your app that calls the subscriber API:

```javascript
// Express.js example
app.post('/signup', async (req, res) => {
  const { name, email } = req.body;

  // Add to drip campaign - workflow runs automatically via cron
  await fetch('https://YOUR_PROJECT.api.codehooks.io/dev/subscribers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email })
  });

  res.json({ success: true });
});
```

### Zapier Integration

1. Use Zapier's Webhooks by Zapier action
2. Set method to POST
3. URL: `https://YOUR_PROJECT.api.codehooks.io/dev/subscribers`
4. Data: `{"name":"{{name}}","email":"{{email}}"}`
5. Headers: `Content-Type: application/json`

This allows you to automatically add subscribers from forms, Typeform, Google Sheets, etc.

## Troubleshooting Examples

### Check if subscriber exists

```bash
curl $API_URL/subscribers | jq '.subscribers[] | select(.email=="alice@example.com")'
```

### Find subscribers by workflow status

```bash
# Pending
curl $API_URL/subscribers | jq '.subscribers[] | select(.workflowStatus=="pending")'

# Active
curl $API_URL/subscribers | jq '.subscribers[] | select(.workflowStatus=="active")'

# Completed
curl $API_URL/subscribers | jq '.subscribers[] | select(.workflowStatus=="completed")'
```

### Check which emails have been sent

```bash
curl $API_URL/subscribers | jq '.subscribers[] | {email, emailsSent}'
```
