/**
 * Example Webhook Receiver
 *
 * This is a simple Express.js server that receives and verifies
 * webhooks from the SaaS Metering System.
 *
 * Installation:
 *   npm install express
 *
 * Usage:
 *   WEBHOOK_SECRET=your_secret node webhook-receiver.js
 *
 * Then update your metering config with:
 *   "url": "http://localhost:3000/webhooks/metering"
 */

const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec_test_secret';

// Parse JSON with raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(payload, signature, timestamp, secret) {
  // Reject old requests (> 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    console.log('⚠️  Webhook timestamp too old');
    return false;
  }

  // Compute expected signature
  const sigBasestring = `${timestamp}.${payload}`;
  const expectedSignature = 'v1=' + crypto
    .createHmac('sha256', secret)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  // Compare using timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch (error) {
    console.log('⚠️  Signature comparison failed:', error.message);
    return false;
  }
}

/**
 * Webhook endpoint
 */
app.post('/webhooks/metering', (req, res) => {
  console.log('\n📨 Received webhook');
  console.log('─────────────────────────────────────────');

  // Extract headers
  const signature = req.headers['x-webhook-signature'];
  const timestamp = parseInt(req.headers['x-webhook-timestamp']);

  // Verify signature
  if (!signature || !timestamp) {
    console.log('❌ Missing signature or timestamp');
    return res.status(400).json({ error: 'Missing signature headers' });
  }

  const isValid = verifyWebhookSignature(
    req.rawBody,
    signature,
    timestamp,
    WEBHOOK_SECRET
  );

  if (!isValid) {
    console.log('❌ Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log('✅ Signature verified');

  // Process webhook payload
  const { type, customerId, period, data } = req.body;

  console.log(`\nWebhook Type: ${type}`);
  console.log(`Customer ID: ${customerId}`);
  console.log(`Period: ${period}`);
  console.log(`\nPeriod Range:`);
  console.log(`  Start: ${data.periodStart}`);
  console.log(`  End:   ${data.periodEnd}`);
  console.log(`  Timestamp: ${data.timestamp}`);
  console.log(`\nAggregated Events:`);

  for (const [eventType, value] of Object.entries(data.events)) {
    console.log(`  ${eventType}: ${value}`);
  }

  console.log(`\nTotal Events Processed: ${data.eventCount}`);
  console.log('─────────────────────────────────────────\n');

  // Example: Process the aggregation data
  processAggregation(customerId, period, data);

  // Respond with 200 OK
  res.json({ received: true });
});

/**
 * Process aggregation data
 * This is where you would integrate with your billing system, analytics, etc.
 */
function processAggregation(customerId, period, data) {
  // Example: Log to console
  console.log(`💡 Processing ${period} aggregation for ${customerId}`);

  // Example use cases:

  // 1. Billing: Calculate invoice amount based on usage
  if (period === 'monthly') {
    const apiCalls = data.events['api.calls'] || 0;
    const pricePerCall = 0.001; // $0.001 per API call
    const totalCost = apiCalls * pricePerCall;
    console.log(`   💰 Billing: ${apiCalls} API calls = $${totalCost.toFixed(2)}`);
  }

  // 2. Alerting: Check for unusual usage
  const storageMB = (data.events['storage.bytes'] || 0) / 1048576;
  if (storageMB > 1000) { // Alert if > 1 GB
    console.log(`   ⚠️  Alert: High storage usage (${storageMB.toFixed(2)} MB)`);
  }

  // 3. Analytics: Track response times
  const avgResponseTime = data.events['response.time.ms'];
  if (avgResponseTime && avgResponseTime > 200) {
    console.log(`   📊 Analytics: Slow response time (${avgResponseTime.toFixed(2)}ms avg)`);
  }

  // 4. Error tracking
  const errorCount = data.events['errors.count'] || 0;
  if (errorCount > 10) {
    console.log(`   🚨 Error Spike: ${errorCount} errors detected`);
  }
}

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Webhook Receiver',
    endpoints: {
      webhook: 'POST /webhooks/metering'
    }
  });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log('🚀 Webhook Receiver Started');
  console.log('════════════════════════════════════════');
  console.log(`Listening on: http://localhost:${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhooks/metering`);
  console.log(`Webhook Secret: ${WEBHOOK_SECRET}`);
  console.log('════════════════════════════════════════\n');
  console.log('Waiting for webhooks...\n');
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});
