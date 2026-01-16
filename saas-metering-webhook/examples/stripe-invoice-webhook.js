/**
 * Stripe Invoice Webhook Handler
 *
 * This example shows how to receive metering webhooks and create
 * Stripe invoices for usage-based billing.
 *
 * Key concept: Use the Stripe subscription ID as the customerId when
 * sending usage events. This makes it trivial to create invoices.
 *
 * Installation:
 *   npm install stripe express
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx \
 *   WEBHOOK_SECRET=whsec_xxx \
 *   node stripe-invoice-webhook.js
 *
 * Then configure your metering system webhook to point to:
 *   https://your-server.com/webhooks/metering
 */

const express = require('express');
const crypto = require('crypto');

// Initialize Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());

// Webhook secret from your metering system config
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec_your_secret';

// Pricing configuration (customize for your business)
const PRICING = {
  'api.calls': {
    unitPrice: 0.001,        // $0.001 per API call
    description: 'API Calls'
  },
  'storage.bytes': {
    unitPrice: 0.00000001,   // ~$0.01 per GB
    description: 'Storage',
    formatValue: (bytes) => `${(bytes / 1073741824).toFixed(2)} GB`
  },
  'compute.seconds': {
    unitPrice: 0.0001,       // $0.0001 per second
    description: 'Compute Time',
    formatValue: (seconds) => `${(seconds / 3600).toFixed(2)} hours`
  },
  'response.time.ms': {
    // This is a metric, not billable - skip it
    unitPrice: 0,
    description: 'Avg Response Time'
  }
};

/**
 * Verify webhook signature (HMAC-SHA256)
 */
function verifyWebhookSignature(payload, signature, timestamp, secret) {
  // Reject old requests (> 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    console.error('Webhook timestamp too old');
    return false;
  }

  // Compute expected signature
  const sigBasestring = `${timestamp}.${payload}`;
  const expectedSignature = 'v1=' + crypto
    .createHmac('sha256', secret)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/**
 * Format period for invoice description
 */
function formatPeriod(periodStart, periodEnd) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return `${monthNames[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
}

/**
 * Main webhook handler
 */
app.post('/webhooks/metering', async (req, res) => {
  // Get signature headers
  const signature = req.headers['x-webhook-signature'];
  const timestamp = parseInt(req.headers['x-webhook-timestamp']);
  const payload = JSON.stringify(req.body);

  // Verify signature
  if (!verifyWebhookSignature(payload, signature, timestamp, WEBHOOK_SECRET)) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { type, customerId, period, data } = req.body;

  console.log(`Received ${type} webhook for ${customerId} (${period})`);

  // Only process completed aggregations
  if (type !== 'aggregation.completed') {
    return res.json({ received: true, skipped: 'Not an aggregation event' });
  }

  try {
    // The customerId IS the Stripe subscription ID
    const subscriptionId = customerId;

    // Get subscription to find the Stripe customer
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const stripeCustomerId = subscription.customer;

    console.log(`Creating invoice for Stripe customer ${stripeCustomerId}`);

    // Track what we're billing
    const invoiceItems = [];
    let totalAmount = 0;

    // Create invoice items for each usage metric
    for (const [metric, value] of Object.entries(data.events)) {
      const config = PRICING[metric];

      if (!config) {
        console.log(`  Skipping unknown metric: ${metric}`);
        continue;
      }

      if (config.unitPrice === 0) {
        console.log(`  Skipping non-billable metric: ${metric} = ${value}`);
        continue;
      }

      const amount = Math.round(value * config.unitPrice * 100); // Convert to cents

      if (amount > 0) {
        const formattedValue = config.formatValue
          ? config.formatValue(value)
          : value.toLocaleString();

        const description = `${config.description}: ${formattedValue} (${formatPeriod(data.periodStart, data.periodEnd)})`;

        const invoiceItem = await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          amount,
          currency: 'usd',
          description
        });

        invoiceItems.push({
          metric,
          value,
          amount: amount / 100,
          invoiceItemId: invoiceItem.id
        });

        totalAmount += amount;

        console.log(`  Added: ${description} = $${(amount / 100).toFixed(2)}`);
      }
    }

    // Only create invoice if there are billable items
    if (invoiceItems.length === 0) {
      console.log('No billable items - skipping invoice creation');
      return res.json({
        received: true,
        skipped: 'No billable items',
        customerId,
        period
      });
    }

    // Create and finalize the invoice
    const invoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      auto_advance: true,  // Auto-finalize and attempt payment
      collection_method: 'charge_automatically',
      description: `Usage charges for ${formatPeriod(data.periodStart, data.periodEnd)}`,
      metadata: {
        metering_period: period,
        metering_period_start: data.periodStart,
        metering_period_end: data.periodEnd,
        subscription_id: subscriptionId
      }
    });

    console.log(`Created invoice ${invoice.id} for $${(totalAmount / 100).toFixed(2)}`);

    // Optionally finalize immediately (or let auto_advance handle it)
    // await stripe.invoices.finalizeInvoice(invoice.id);

    res.json({
      success: true,
      invoiceId: invoice.id,
      invoiceUrl: invoice.hosted_invoice_url,
      amount: totalAmount / 100,
      items: invoiceItems,
      customerId,
      period
    });

  } catch (error) {
    console.error('Error creating invoice:', error.message);

    // Handle specific Stripe errors
    if (error.type === 'StripeInvalidRequestError') {
      if (error.message.includes('No such subscription')) {
        return res.status(400).json({
          error: 'Invalid subscription ID',
          customerId,
          message: 'The customerId must be a valid Stripe subscription ID'
        });
      }
    }

    res.status(500).json({
      error: 'Failed to create invoice',
      message: error.message
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Stripe Invoice Webhook Handler',
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Stripe Invoice Webhook Handler running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/metering`);
  console.log('');
  console.log('Configured pricing:');
  for (const [metric, config] of Object.entries(PRICING)) {
    if (config.unitPrice > 0) {
      console.log(`  ${metric}: $${config.unitPrice} per unit`);
    }
  }
});
