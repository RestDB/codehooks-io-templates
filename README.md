# codehooks-io-templates

Boilerplate Codehooks.io application templates.

## Quick Start

There are three ways to use these templates:

### 1. Create a new project with a template
```bash
coho create myproject --template <template-name>
cd myproject
npm install
coho deploy
```

### 2. Interactive template selection during project creation
```bash
coho create myproject
# Select a template from the interactive menu
cd myproject
npm install
coho deploy
```

### 3. Install a template in an existing directory
```bash
coho install <template-name>
npm install
coho deploy
```

## Available Templates

### Backend & API Templates

#### CRUD API Backend
Simple CRUD API database backend using the Codehooks NoSQL database REST API.

```bash
coho create myapi --template crud-api-backend
```

#### React BFF (Backend for Frontend)
Backend for Frontend pattern with React application.

```bash
coho create myapp --template react-bff
```

### Frontend Templates

#### Static Website (Tailwind CSS)
Static website template with Tailwind CSS.

```bash
coho create mysite --template static-website-tailwindcss
```

### Advanced Integration Templates

#### Slack Memory Bot
Advanced Slack bot with pluggable memory adapters (keyword search and vector search). Demonstrates webhook handling, database operations, and modular architecture.

```bash
coho create mybot --template slack-memory-bot
```

#### Stripe Webhook Handler (Production)
Production-ready Stripe webhook handler with TypeScript, signature verification, and event storage.

```bash
coho create mywebhooks --template stripe-webhook-handler
```

#### Webhook Delivery System
Production-ready webhook delivery system with queue-based processing, automatic retries, and HMAC signing. Perfect for sending webhooks to external services when events occur in your application.

```bash
coho create mywebhooks --template webhook-delivery
```

#### Drip Email Workflow
3-step drip email campaign with SendGrid/Mailgun support, subscriber management, and scheduled delivery. Includes dynamic step configuration and professional email templates.

```bash
coho create my-drip-campaign --template drip-email-workflow
```

#### SaaS Metering Webhook
Production-ready usage metering system for SaaS applications. Captures events per customer, aggregates them over configurable time periods (hourly, daily, weekly, monthly, yearly), and delivers results via HMAC-signed webhooks. Supports 7 aggregation operations (sum, avg, min, max, count, first, last) and includes batch event ingestion, cron-based processing, and comprehensive testing tools.

```bash
coho create my-metering --template saas-metering-webhook
```

### Minimal Webhook Templates

These templates provide minimal, educational implementations of webhook handlers for popular services. Each includes proper signature verification, basic event handling, and comprehensive documentation. Perfect for learning or as a starting point for your own integrations.

#### GitHub Webhooks
Handle GitHub events (push, pull requests, issues) with HMAC SHA-256 verification.

```bash
coho create github-webhook --template webhook-github-minimal
```

#### Stripe Webhooks
Handle Stripe payment events with signature verification.

```bash
coho create stripe-webhook --template webhook-stripe-minimal
```

#### Discord Webhooks
Handle Discord bot interactions and slash commands with Ed25519 verification.

```bash
coho create discord-webhook --template webhook-discord-minimal
```

#### Shopify Webhooks
Handle Shopify e-commerce events (orders, products, customers) with HMAC verification.

```bash
coho create shopify-webhook --template webhook-shopify-minimal
```

#### Clerk Webhooks
Handle Clerk authentication events (user signup, login, session management) with Svix verification.

```bash
coho create clerk-webhook --template webhook-clerk-minimal
```

#### Slack Webhooks
Handle Slack events and bot interactions with signature verification and URL verification.

```bash
coho create slack-webhook --template webhook-slack-minimal
```

#### Twilio Webhooks
Handle Twilio SMS and voice call events with TwiML responses and signature verification.

```bash
coho create twilio-webhook --template webhook-twilio-minimal
```
