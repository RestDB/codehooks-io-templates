# Discord Webhook Handler (Minimal)

A minimal Discord interactions webhook handler for Codehooks.io that receives and processes Discord bot interactions.

## Features

- ✅ Secure signature verification (Ed25519)
- ✅ Handles slash commands and interactions
- ✅ Minimal code (~75 lines)
- ✅ Production-ready

## Setup

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Give it a name and create
4. Note your **Application ID** and **Public Key**

### 2. Deploy to Codehooks.io

```bash
coho create myapp --template webhook-discord-minimal
cd myapp
npm install
coho deploy
```

### 3. Set Environment Variables

In your Codehooks.io project settings, add:

```
DISCORD_PUBLIC_KEY=your_public_key_here
```

### 4. Configure Discord Webhook

1. In Discord Developer Portal → Your App → General Information
2. Set **Interactions Endpoint URL** to: `https://your-project.api.codehooks.io/dev/interactions`
3. Discord will verify the endpoint (it should succeed)
4. Click "Save Changes"

### 5. Create a Slash Command

1. Go to your app → Slash Commands
2. Click "New Command"
3. Name: `hello`
4. Description: `Say hello`
5. Save

### 6. Install Bot to Server

1. Go to OAuth2 → URL Generator
2. Select scopes: `applications.commands`, `bot`
3. Copy the generated URL and open it in browser
4. Select a server and authorize

## Supported Interactions

- **Type 1 (PING)** - Verification
- **Type 2 (Application Command)** - Slash commands
- **Type 3 (Message Component)** - Buttons, select menus

## Testing

In your Discord server, type `/hello` and the bot should respond!

Check logs:
```bash
coho logs --tail 50
```

## Customization

Add custom slash command handlers:

```javascript
if (interaction.type === 2) {
  const { name, options } = interaction.data;

  if (name === 'ping') {
    return res.json({
      type: 4,
      data: { content: 'Pong!' }
    });
  }
}
```

## Security

- Always verify signatures in production
- Never expose your bot token
- Use environment variables for secrets

## Resources

- [Discord Interactions Documentation](https://discord.com/developers/docs/interactions/receiving-and-responding)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Codehooks.io Documentation](https://codehooks.io/docs)
