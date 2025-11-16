# Slack Webhook Handler (Minimal)

A minimal Slack webhook handler for Codehooks.io that receives and processes Slack events with an echo bot implementation.

## Features

- ✅ Secure signature verification (HMAC SHA-256)
- ✅ URL verification for Slack app setup
- ✅ Echo bot that logs incoming messages
- ✅ Minimal code (~90 lines)
- ✅ Production-ready

## Setup

### 1. Create Slack App

1. Go to [Slack API](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Give it a name and select your workspace
4. Click "Create App"

### 2. Deploy to Codehooks.io

```bash
npm install
npm run deploy
```

### 3. Set Environment Variables

In your Codehooks.io project settings, add:

```
SLACK_SIGNING_SECRET=your_signing_secret_here
```

Get your Signing Secret from: Slack App → Basic Information → App Credentials → Signing Secret

### 4. Configure Slack Event Subscriptions

1. In your Slack App → Event Subscriptions
2. Toggle "Enable Events" to **On**
3. Set **Request URL** to: `https://your-project.api.codehooks.io/dev/webhook`
4. Slack will verify the URL (you should see a green checkmark)
5. Under "Subscribe to bot events", add:
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages to the bot
6. Click "Save Changes"

### 5. Install Bot to Workspace

1. Go to OAuth & Permissions
2. Under "Scopes" → "Bot Token Scopes", add:
   - `channels:history` - View messages in public channels
   - `groups:history` - View messages in private channels
   - `im:history` - View messages in DMs
   - `chat:write` - Send messages (if you want to post back)
3. Click "Install to Workspace"
4. Authorize the app

### 6. Invite Bot to Channel

In your Slack channel, type:
```
/invite @YourBotName
```

## How It Works

This minimal example logs incoming messages to the console. The echo functionality is demonstrated through logging - to actually post messages back to Slack, you'll need to:

1. Add the Slack Web API client
2. Use the bot token to post messages
3. Handle the message event and post back using `chat.postMessage`

## Testing

1. Send a message in a channel where your bot is present
2. Check the Codehooks logs to see the message was received and logged

Check logs:
```bash
coho logs --tail 50
```

You should see:
```
Event received: message
Message from: U1234567890
Text: hello bot
Echo: hello bot
```

## Customization

### Add Message Posting

To actually post messages back to Slack, install the Slack SDK:

```bash
npm install @slack/web-api
```

Then update the message handler:

```javascript
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// In your message event handler:
if (event.type === 'message' && !event.bot_id && event.text) {
  await slack.chat.postMessage({
    channel: event.channel,
    text: `Echo: ${event.text}`
  });
}
```

### Handle Other Events

Subscribe to more events in your Slack app configuration:

```javascript
if (event.type === 'app_mention') {
  console.log('Bot was mentioned:', event.text);
}

if (event.type === 'reaction_added') {
  console.log('Reaction added:', event.reaction);
}
```

## Supported Events

This handler processes:

- **url_verification** - Initial webhook verification
- **event_callback** - All subscribed Slack events
- **message events** - Messages from users (not bots)

## Security

- Always verify request signatures in production
- Never expose your `SLACK_SIGNING_SECRET` or bot token
- The handler rejects requests older than 5 minutes
- Uses timing-safe comparison for signature verification

## Common Use Cases

- **Echo Bot** - Repeat messages back to users
- **Command Bot** - Respond to specific commands
- **Notification Handler** - Process and log events
- **Workflow Automation** - Trigger actions based on messages
- **Moderation Bot** - Monitor and respond to channel activity

## Resources

- [Slack Events API Documentation](https://api.slack.com/apis/connections/events-api)
- [Slack Request Verification](https://api.slack.com/authentication/verifying-requests-from-slack)
- [Slack Web API](https://api.slack.com/web)
- [Codehooks.io Documentation](https://codehooks.io/docs)
