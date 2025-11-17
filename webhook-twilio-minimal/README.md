# Twilio Webhook Handler (Minimal)

A minimal Twilio webhook handler for Codehooks.io that receives and processes SMS and voice call events.

## Features

- ✅ Secure signature verification (HMAC SHA-1)
- ✅ Handles SMS and voice call events
- ✅ TwiML responses for incoming messages/calls
- ✅ Minimal code (~100 lines)
- ✅ Production-ready

## Setup

### 1. Deploy to Codehooks.io

```bash
coho create myapp --template webhook-twilio-minimal
cd myapp
npm install
coho deploy
```

### 2. Set Environment Variables

In your Codehooks.io project settings, add:

```
TWILIO_AUTH_TOKEN=your_auth_token_here
```

Get your Auth Token from: [Twilio Console](https://console.twilio.com/)

### 3. Configure Twilio Webhook

#### For SMS Messages:

1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to Phone Numbers → Manage → Active numbers
3. Click on your phone number
4. Scroll to "Messaging Configuration"
5. Set **A MESSAGE COMES IN** webhook to: `https://your-project.api.codehooks.io/dev/webhook`
6. Set method to `POST`
7. Click "Save"

#### For Voice Calls:

1. In the same phone number configuration
2. Scroll to "Voice Configuration"
3. Set **A CALL COMES IN** webhook to: `https://your-project.api.codehooks.io/dev/webhook`
4. Set method to `POST`
5. Click "Save"

## Supported Events

This handler processes:

- **SMS Messages** - Incoming and status updates
- **Voice Calls** - Incoming calls and call status
- **Message Status** - Delivery notifications

## Testing

### Test SMS:
Send a text message to your Twilio phone number. The handler will:
1. Log the message details
2. Respond with an echo message

### Test Voice:
Call your Twilio phone number. The handler will:
1. Log the call details
2. Play a greeting message

Check logs:
```bash
coho logs --tail 50
```

## Customization

### Custom SMS Response:

```javascript
if (Body) {
  const response = processMessage(Body); // Your logic
  return res
    .type('text/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${response}</Message>
</Response>`);
}
```

### Custom Voice Response:

```javascript
if (Direction === 'inbound') {
  return res
    .type('text/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Welcome to our service!</Say>
  <Gather numDigits="1">
    <Say>Press 1 for sales, 2 for support</Say>
  </Gather>
</Response>`);
}
```

## Security

- Always verify request signatures in production
- Never expose your `TWILIO_AUTH_TOKEN`
- Use HTTPS endpoints only
- Twilio will only call HTTPS URLs

## Common Use Cases

- **SMS Bots** - Automated customer service
- **Notifications** - Order updates, alerts
- **Two-factor auth** - SMS verification codes
- **IVR Systems** - Interactive voice menus
- **Call routing** - Forward calls based on logic

## TwiML Resources

TwiML is Twilio's XML-based language for controlling calls and messages:

- `<Say>` - Text-to-speech
- `<Play>` - Play audio file
- `<Gather>` - Collect user input
- `<Record>` - Record audio
- `<Message>` - Send SMS

## Resources

- [Twilio Webhooks Documentation](https://www.twilio.com/docs/usage/webhooks)
- [TwiML Documentation](https://www.twilio.com/docs/voice/twiml)
- [Twilio Request Validation](https://www.twilio.com/docs/usage/security#validating-requests)
- [Codehooks.io Documentation](https://codehooks.io/docs)
