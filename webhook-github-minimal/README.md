# GitHub Webhook Handler (Minimal)

A minimal GitHub webhook handler for Codehooks.io that receives and processes GitHub events.

## Features

- ✅ Secure signature verification (HMAC SHA-256)
- ✅ Handles common events (push, pull_request, issues)
- ✅ Minimal code (~60 lines)
- ✅ Production-ready

## Setup

### 1. Deploy to Codehooks.io

```bash
coho create myapp --template webhook-github-minimal
cd myapp
npm install
coho deploy
```

### 2. Set Environment Variables

Set your environment variables using one of these methods:

**Option A: Via Codehooks Studio**
1. Go to your project in Codehooks Studio
2. Navigate to Settings → Environment Variables
3. Add: `GITHUB_WEBHOOK_SECRET` with your webhook secret value

**Option B: Via CLI**
```bash
coho set-env GITHUB_WEBHOOK_SECRET your_webhook_secret_here
```

### 3. Configure GitHub Webhook

1. Go to your GitHub repository → Settings → Webhooks → Add webhook
2. Set **Payload URL** to: `https://your-project.api.codehooks.io/dev/webhook`
3. Set **Content type** to: `application/json`
4. Set **Secret** to: The same value as `GITHUB_WEBHOOK_SECRET`
5. Select events you want to receive (or choose "Send me everything")
6. Click "Add webhook"

## Supported Events

This handler logs information for:

- **push** - Code pushes to repository
- **pull_request** - PR opened, closed, merged, etc.
- **issues** - Issue created, edited, closed, etc.
- **All other events** - Logged with basic info

## Testing

After setup, trigger an event in GitHub (e.g., push a commit) and check your Codehooks.io logs:

```bash
coho logs --tail 50
```

## Customization

Add your own event handlers in the `switch` statement:

```javascript
case 'star':
  console.log('Repository starred by:', req.body.sender?.login);
  break;
```

## Security

- Always set `GITHUB_WEBHOOK_SECRET` in production
- Signature verification prevents unauthorized requests
- Uses timing-safe comparison to prevent timing attacks

## Resources

- [GitHub Webhooks Documentation](https://docs.github.com/en/webhooks)
- [Codehooks.io Documentation](https://codehooks.io/docs)
