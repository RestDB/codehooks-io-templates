/**
 * Test Webhook Receiver
 *
 * A simple Express server to test webhook deliveries locally.
 *
 * Usage:
 *   1. npm install express
 *   2. node test-receiver.js
 *   3. In another terminal: ngrok http 3000
 *   4. Register the ngrok URL as a webhook
 */

import express from 'express';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;

// Your webhook secret (get this from the webhook registration response)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec_your_secret_here';

// Store received webhooks for inspection
const receivedWebhooks = [];

// Parse raw body for signature verification
app.use(express.raw({ type: 'application/json' }));

/**
 * Verify webhook signature
 */
function verifySignature(payload, signature, timestamp) {
  const currentTime = Math.floor(Date.now() / 1000);

  // Reject old requests (older than 5 minutes)
  if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
    console.log('⚠️  Request timestamp too old');
    return false;
  }

  // Compute expected signature
  const sigBasestring = `${timestamp}.${payload}`;
  const expectedSignature = 'v1=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  // Compare signatures using timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch (err) {
    console.log('⚠️  Signature comparison error:', err.message);
    return false;
  }
}

/**
 * Main webhook endpoint
 */
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const webhookId = req.headers['x-webhook-id'];
  const payload = req.body.toString();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📨 Webhook received at', new Date().toISOString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Parse the payload
    const event = JSON.parse(payload);

    // Check if this is a verification request
    if (event.type === 'webhook.verification') {
      console.log('🔍 Webhook verification request (Stripe-style)');
      console.log('   Token:', event.verification_token);
      console.log('✅ Responding with 200 OK\n');
      return res.status(200).send('OK');
    }

    if (event.type === 'url_verification') {
      console.log('🔍 URL verification request (Slack-style)');
      console.log('   Challenge:', event.challenge);
      console.log('✅ Responding with challenge\n');
      return res.json({ challenge: event.challenge });
    }

    // Verify signature (skip for verification requests in real scenario)
    if (!verifySignature(payload, signature, timestamp)) {
      console.log('❌ Invalid signature!');
      console.log('   Received:', signature);
      console.log('   Check that WEBHOOK_SECRET is correct\n');
      return res.status(401).send('Invalid signature');
    }

    console.log('✅ Signature verified');
    console.log('📋 Event details:');
    console.log('   ID:', event.id);
    console.log('   Type:', event.type);
    console.log('   Webhook ID:', webhookId);
    console.log('   Timestamp:', new Date(event.created * 1000).toISOString());
    console.log('\n📦 Event data:');
    console.log(JSON.stringify(event.data, null, 2));

    // Store the webhook
    receivedWebhooks.push({
      receivedAt: new Date().toISOString(),
      event,
      headers: {
        signature,
        timestamp,
        webhookId
      }
    });

    console.log(`\n✅ Webhook processed successfully (Total received: ${receivedWebhooks.length})\n`);
    res.status(200).send('OK');

  } catch (error) {
    console.log('❌ Error processing webhook:', error.message);
    console.log('   Payload:', payload.substring(0, 200));
    res.status(400).send('Invalid payload');
  }
});

/**
 * View all received webhooks
 */
app.get('/webhooks', (req, res) => {
  res.json({
    count: receivedWebhooks.length,
    webhooks: receivedWebhooks
  });
});

/**
 * Clear received webhooks
 */
app.delete('/webhooks', (req, res) => {
  const count = receivedWebhooks.length;
  receivedWebhooks.length = 0;
  res.json({ message: `Cleared ${count} webhooks` });
});

/**
 * Health check
 */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Webhook test receiver',
    endpoints: {
      webhook: 'POST /webhook',
      list: 'GET /webhooks',
      clear: 'DELETE /webhooks'
    },
    stats: {
      received: receivedWebhooks.length,
      secret_configured: WEBHOOK_SECRET !== 'whsec_your_secret_here'
    }
  });
});

app.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 Webhook Test Receiver');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('📝 Endpoints:');
  console.log(`   Webhook receiver: http://localhost:${PORT}/webhook`);
  console.log(`   View received:    http://localhost:${PORT}/webhooks`);
  console.log(`   Clear history:    http://localhost:${PORT}/webhooks (DELETE)`);
  console.log('');
  console.log('🔧 Setup:');
  console.log('   1. Expose via ngrok: ngrok http 3000');
  console.log('   2. Register the ngrok URL as a webhook');
  console.log('   3. Set WEBHOOK_SECRET env var to your webhook secret');
  console.log('');
  console.log('⚙️  Configuration:');
  console.log(`   Port: ${PORT}`);
  console.log(`   Secret configured: ${WEBHOOK_SECRET !== 'whsec_your_secret_here' ? '✅' : '❌ (using default)'}`);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('Waiting for webhooks...\n');
});
