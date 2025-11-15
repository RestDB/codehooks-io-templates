# Slack Memory Bot - Codehooks.io Example template

A production-ready Slack bot that stores and recalls information using pluggable memory adapters. Perfect showcase for webhook handling with [codehooks.io](https://codehooks.io).

## Features

- **Pluggable Memory Architecture**: Swap between different storage backends
- **Two Memory Adapters**:
  - `SimpleMemoryAdapter`: Keyword-based search using Codehooks NoSQL (no external dependencies)
  - `OpenAIVectorAdapter`: Semantic search using OpenAI embeddings
- **Natural Language Commands**: Intuitive interaction patterns
- **User-Scoped Memory**: Each user has private memory storage
- **TypeScript**: Type-safe codebase with full type definitions
- **Production Ready**: Includes Slack signature verification and error handling

## Architecture

```
┌─────────────────┐
│  Slack Events   │
│   (Webhooks)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Codehooks.io    │
│  Entry Point    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────────┐
│ Message Parser  │──────▶│  Memory Adapter      │
│ & Router        │      │  (Interface)         │
└─────────────────┘      └──────────┬───────────┘
                                    │
                   ┌────────────────┴────────────────┐
                   │                                 │
                   ▼                                 ▼
         ┌──────────────────┐            ┌──────────────────┐
         │ SimpleAdapter    │            │ OpenAIAdapter    │
         │ (Keyword Search) │            │ (Vector Search)  │
         └──────────────────┘            └──────────────────┘
                   │                                 │
                   ▼                                 ▼
         ┌──────────────────┐            ┌──────────────────┐
         │ Codehooks NoSQL  │            │ OpenAI API       │
         └──────────────────┘            │ + Codehooks DB   │
                                         └──────────────────┘
```

## Connect to a project

Create or use an existing project folder for the code.

```bash
mkdir my-slack-bot
cd my-slack-bot
coho init --empty
```

## Install the template with the CLI

```bash
coho install 'slack-memory-bot'
npm install
```

Verify that all the files are downloaded ok, then run the deploy command next.

## Deploy

```bash
coho deploy
```

Your API is now live at `https://YOUR_PROJECT.api.codehooks.io/dev/`

## Quick Start (5 Minutes!)

### 1. Configure Slack Credentials

```bash
# Set up Simple adapter (default - no external dependencies)
coho env set MEMORY_ADAPTER "simple"

# Add your Slack credentials (get from api.slack.com/apps)
coho env set SLACK_BOT_TOKEN "xoxb-..."
coho env set SLACK_SIGNING_SECRET "..."
coho env set SLACK_BOT_USER_ID "U..."
```

### 2. Create & Configure Slack App

#### Option A: Using App Manifest (Recommended - 2 minutes!)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **"From an app manifest"**
2. Select your workspace → Next
3. Copy the contents of `slack-app-manifest.json` from this repo
4. **Important**: Update the `request_url` with your deployment URL: `https://YOUR_PROJECT.api.codehooks.io/dev/slack/events`
5. Paste the manifest → Click **Create**
6. Click **Install to Workspace** and authorize
7. Get your credentials:
   - **Bot Token**: OAuth & Permissions → Copy "Bot User OAuth Token"
   - **Signing Secret**: Basic Information → Copy "Signing Secret"
   - **Bot User ID**: App Home → Copy the Member ID under "Your App's Bot User"

Done! All scopes and event subscriptions are configured automatically.

#### Option B: Manual Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → "From scratch"
2. Name: "Memory Bot", select your workspace
3. **OAuth & Permissions** → Add Bot Token Scopes:
   - `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`
4. **Install App** to workspace → Copy **Bot User OAuth Token**
5. **Event Subscriptions** → Enable Events
   - Request URL: `https://YOUR_PROJECT.api.codehooks.io/dev/slack/events`
   - Subscribe to: `app_mention`, `message.im`
6. Copy **Signing Secret** from **Basic Information**
7. Get **Bot User ID** from **App Home** or your workspace

That's it! Your bot is ready to use.

---

## Full Setup Guide

### Prerequisites

- [Codehooks.io account](https://codehooks.io)
- [Slack workspace](https://slack.com) with admin access
- [Codehooks CLI](https://codehooks.io/docs/cli) installed
- Node.js 18+ (for npm install)

### Detailed Slack App Configuration

#### OAuth & Permissions

Add these Bot Token Scopes:

- `app_mentions:read` - Read messages that mention your bot
- `chat:write` - Send messages as the bot
- `im:history` - View messages in DMs
- `im:read` - View basic info about DMs
- `im:write` - Allow users to send DMs to the bot (required!)

Install the app to your workspace and copy the **Bot User OAuth Token** (starts with `xoxb-`)

#### Configure Event Subscriptions

You'll configure this after deploying to Codehooks (see step 5)

### 4. Deploy to Codehooks

Codehooks compiles TypeScript automatically, so no build step needed!

```bash
# Initialize project in your folder
coho init YOUR_PROJECT_NAME --empty

# Deploy (Codehooks compiles TypeScript automatically)
coho deploy
```

After deployment, you'll get a URL like:

```
https://YOUR_PROJECT.api.codehooks.io/dev/
```

### 5. Configure Environment Variables

Set these in your Codehooks project settings or via CLI:

#### Required for All Adapters

```bash
coho env set SLACK_BOT_TOKEN "xoxb-your-bot-token"
coho env set SLACK_SIGNING_SECRET "your-signing-secret"
coho env set SLACK_BOT_USER_ID "U123456789"  # Your bot's user ID
```

#### For Simple Adapter (Default)

```bash
coho env set MEMORY_ADAPTER "simple"
```

#### For OpenAI Vector Adapter

```bash
coho env set MEMORY_ADAPTER "openai"
coho env set OPENAI_API_KEY "sk-..."
```

**Finding Your Values:**

- `SLACK_BOT_TOKEN`: From OAuth & Permissions page
- `SLACK_SIGNING_SECRET`: From Basic Information page
- `SLACK_BOT_USER_ID`: Install the bot, then go to your Slack workspace and copy the ID from the bot's profile URL

### 6. Configure Slack Event Subscriptions

1. Go to your Slack app's "Event Subscriptions" page
2. Enable Events
3. Set Request URL to: `https://YOUR_PROJECT.api.codehooks.io/dev/slack/events`
4. Wait for the green "Verified" checkmark
5. Subscribe to these bot events:
   - `app_mention` - When bot is @mentioned
   - `message.im` - Direct messages to the bot
6. Save Changes
7. Reinstall the app to your workspace (Slack will prompt you)

## Usage

### In Slack Channels

Mention the bot:

```
@memorybot remember John likes pizza
@memorybot recall what does John like
@memorybot list my memories
@memorybot help
```

### In Direct Messages

No need to mention the bot:

```
remember Sarah's birthday is May 15th
recall Sarah
list
forget abc123
clear all
```

## Commands

| Command           | Description         | Example                     |
| ----------------- | ------------------- | --------------------------- |
| `remember [text]` | Store a memory      | `remember John likes pizza` |
| `recall [query]`  | Search memories     | `recall pizza`              |
| `list`            | Show all memories   | `list my memories`          |
| `forget [id]`     | Delete a memory     | `forget abc123`             |
| `clear all`       | Delete all memories | `clear all memories`        |
| `help`            | Show help           | `help`                      |

## Memory Adapters

### SimpleMemoryAdapter

- **Use Case**: Development, demos, small-scale usage
- **Search**: Keyword-based matching
- **Cost**: Free (uses Codehooks NoSQL)
- **Setup**: No configuration needed (default)

```bash
coho env set MEMORY_ADAPTER "simple"
```

### OpenAIVectorAdapter

- **Use Case**: Production, semantic search
- **Search**: Vector embeddings with cosine similarity
- **Cost**: ~$0.02 per 1,000 memories (using `text-embedding-3-small`)
- **Setup**: Requires OpenAI API key

```bash
coho env set MEMORY_ADAPTER "openai"
coho env set OPENAI_API_KEY "sk-..."
```

**Semantic Search Example:**

```
remember: "John loves Italian food"
recall: "what cuisine does John prefer?"
→ Finds the memory even with different words!
```

## Project Structure

```
slack/
├── src/
│   ├── index.ts              # Codehooks entry point
│   ├── adapters/
│   │   ├── MemoryAdapter.ts          # Adapter interface
│   │   ├── SimpleMemoryAdapter.ts    # Keyword search
│   │   ├── OpenAIVectorAdapter.ts    # Vector search
│   │   └── index.ts                  # Factory
│   ├── slack/
│   │   ├── events.ts         # Event handlers
│   │   ├── verification.ts   # URL & signature verification
│   │   └── parser.ts         # Message parsing
│   └── utils/
│       └── types.ts          # TypeScript types
├── package.json
├── tsconfig.json
├── config.json               # Codehooks project config
└── README.md
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# Test TypeScript compilation (optional - Codehooks does this automatically)
coho compile

# Optional: Local type checking with tsc
npm run build
```

**Note:**

- Codehooks compiles TypeScript automatically on deployment
- `coho compile` tests compilation without deploying
- The `tsconfig.json` can be auto-generated by Codehooks or customized manually

### Testing

Test the health endpoint:

```bash
curl https://YOUR_PROJECT.api.codehooks.io/dev/health
```

View logs:

```bash
coho logs --follow
```

## Adding a New Memory Adapter

1. Create a new adapter class implementing `MemoryAdapter` interface
2. Add it to `src/adapters/index.ts`
3. Update the factory function to support your adapter type
4. Document environment variables needed

Example skeleton:

```typescript
export class CustomAdapter implements MemoryAdapter {
  getName(): string {
    return 'CustomAdapter';
  }

  async remember(userId: string, content: string): Promise<Memory> {
    // Your implementation
  }

  async recall(userId: string, query: string): Promise<Memory[]> {
    // Your implementation
  }

  // ... implement other methods
}
```

## Troubleshooting

### URL Verification Fails

- Ensure your Codehooks deployment is successful
- Check that the URL is correct: `https://YOUR_PROJECT.api.codehooks.io/dev/slack/events`
- Check logs: `coho logs`

### Bot Doesn't Respond

- Verify bot token is set: `coho env list`
- Check that bot has correct OAuth scopes
- Verify event subscriptions are configured
- Check Slack app is installed in workspace
- Review logs: `coho logs --follow`

### OpenAI Adapter Errors

- Verify API key is valid: `coho env list`
- Check OpenAI account has credits
- Review error messages in logs

### Signature Verification Fails

- Ensure `SLACK_SIGNING_SECRET` is set correctly
- Check timestamp drift (server time sync)

## Security Considerations

- ✅ Slack signature verification prevents unauthorized requests
- ✅ User-scoped memory prevents data leakage between users
- ✅ Environment variables for sensitive credentials
- ✅ No authentication needed for webhook endpoints (Slack verifies)
- ✅ Bot token stored securely in Codehooks environment

## Performance

- **SimpleAdapter**: ~10-50ms per query (depends on memory count)
- **OpenAIAdapter**: ~200-500ms per query (includes API call)
- **Scalability**: Codehooks auto-scales; consider vector DB for 10,000+ memories per user

## Future Enhancements

- [ ] Add Memvid adapter (Python bridge)
- [ ] Support for attachments/images
- [ ] Workspace-wide memory sharing option
- [ ] Memory expiration (TTL)
- [ ] Export memories to JSON/CSV
- [ ] Analytics dashboard

## License

MIT

## About Codehooks.io

This project showcases [codehooks.io](https://codehooks.io) capabilities:

- Webhook handling (Slack Events API)
- NoSQL database (memory storage)
- Environment variables (configuration)
- TypeScript support
- Serverless deployment
- Auto-scaling

Perfect for building webhook integrations with Slack, Stripe, GitHub, and more!
