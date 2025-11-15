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

### CRUD API Backend
Simple CRUD API database backend using the Codehooks NoSQL database REST API.

```bash
# Create new project
coho create myapi --template crud-api-backend

# Or install in current directory
coho install crud-api-backend
```

### React BFF (Backend for Frontend)
Backend for Frontend pattern with React application.

```bash
# Create new project
coho create myapp --template react-bff

# Or install in current directory
coho install react-bff
```

### Static Website (Tailwind CSS)
Static website template with Tailwind CSS.

```bash
# Create new project
coho create mysite --template static-website-tailwindcss

# Or install in current directory
coho install static-website-tailwindcss
```

### Stripe Webhook Handler
Production-ready Stripe webhook handler with signature verification and event storage.

```bash
# Create new project
coho create mywebhooks --template stripe-webhook-handler

# Or install in current directory
coho install stripe-webhook-handler
```

### Slack Memory Bot
Advanced Slack bot with pluggable memory adapters (keyword search and vector search). Demonstrates webhook handling, database operations, and modular architecture.

```bash
# Create new project
coho create mybot --template slack-memory-bot

# Or install in current directory
coho install slack-memory-bot
```
