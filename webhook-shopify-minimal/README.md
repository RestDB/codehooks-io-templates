# Shopify Webhook Handler (Minimal)

A minimal Shopify webhook handler for Codehooks.io that receives and processes Shopify store events.

## Features

- ✅ Secure signature verification (HMAC SHA-256)
- ✅ Handles common e-commerce events
- ✅ Minimal code (~70 lines)
- ✅ Production-ready

## Setup

### 1. Deploy to Codehooks.io

```bash
coho create myapp --template webhook-shopify-minimal
cd myapp
npm install
coho deploy
```

### 2. Set Environment Variables

In your Codehooks.io project settings, add:

```
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret_here
```

### 3. Configure Shopify Webhook

#### Option A: Via Shopify Admin (Recommended for testing)

1. Go to your Shopify Admin → Settings → Notifications
2. Scroll to "Webhooks" section
3. Click "Create webhook"
4. Set **Event** to desired event (e.g., "Order creation")
5. Set **Format** to `JSON`
6. Set **URL** to: `https://your-project.api.codehooks.io/dev/webhook`
7. Click "Save webhook"
8. Copy the webhook's **Secret** and set it as `SHOPIFY_WEBHOOK_SECRET`

#### Option B: Via Shopify API (Programmatic)

Use Shopify Admin API to create webhooks programmatically.

## Supported Topics

This handler processes:

- **orders/create** - New order placed
- **orders/paid** - Order payment received
- **orders/fulfilled** - Order shipped
- **orders/cancelled** - Order cancelled
- **products/create** - New product added
- **products/update** - Product updated
- **customers/create** - New customer registered

## Testing

After creating a webhook:

1. Trigger an event in your Shopify store (e.g., create a test order)
2. Check logs:

```bash
coho logs --tail 50
```

You can also use Shopify's webhook testing feature in the admin panel.

## Customization

Add your own topic handlers:

```javascript
case 'orders/create':
  const order = req.body;
  // Send confirmation email
  // Update inventory
  // Notify fulfillment service
  console.log('Processing order:', order.id);
  break;
```

## Security

- Always verify HMAC signatures in production
- Keep your webhook secret secure
- Use HTTPS endpoints only

## Common Use Cases

- **Order notifications** - Email/SMS alerts
- **Inventory sync** - Update external systems
- **Customer data** - Sync to CRM
- **Analytics** - Track sales metrics
- **Fulfillment** - Trigger shipping workflows

## Resources

- [Shopify Webhooks Documentation](https://shopify.dev/docs/api/admin-rest/2024-01/resources/webhook)
- [Shopify Webhook Topics](https://shopify.dev/docs/api/admin-rest/2024-01/resources/webhook#event-topics)
- [Codehooks.io Documentation](https://codehooks.io/docs)
