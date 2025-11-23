import { app, Datastore } from 'codehooks-js';
import { cron } from 'codehooks-cron';
import crypto from 'crypto';

// Database connection helpers
const getWebhooksDB = async () => {
  const conn = await Datastore.open();
  return conn.collection('webhooks');
};

const getEventsDB = async () => {
  const conn = await Datastore.open();
  return conn.collection('events');
};

// Generate verification token for webhook URLs
function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Generate webhook secret for signing
function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Generate signature for outgoing webhook payloads
function generateSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sigBasestring = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sigBasestring, 'utf8')
    .digest('hex');
  return { signature: `v1=${signature}`, timestamp };
}

// Verify webhook URL (Stripe-style or Slack-style challenge)
async function verifyWebhookUrl(url, verificationToken, verificationType = 'stripe') {
  try {
    if (verificationType === 'stripe') {
      // Stripe-style: Send a test payload with verification token
      const testPayload = JSON.stringify({
        type: 'webhook.verification',
        verification_token: verificationToken,
        created: Math.floor(Date.now() / 1000)
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Codehooks-Webhook/1.0'
        },
        body: testPayload,
        signal: AbortSignal.timeout(10000)
      });

      return response.ok;
    } else if (verificationType === 'slack') {
      // Slack-style: Send challenge parameter
      const challenge = crypto.randomBytes(16).toString('hex');
      const testPayload = JSON.stringify({
        type: 'url_verification',
        challenge: challenge,
        token: verificationToken
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Codehooks-Webhook/1.0'
        },
        body: testPayload,
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) return false;

      const responseData = await response.json();
      return responseData.challenge === challenge;
    }

    return false;
  } catch (error) {
    console.error('Webhook verification failed:', error.message);
    return false;
  }
}

// Codehooks.io has built-in security - all routes are secure by default
// Use app.auth() only if you need to override default behavior

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Outgoing Webhook System',
    version: '2.0.0',
    features: [
      'Queue-based delivery with enqueueFromQuery',
      'Any event type support',
      'Built-in Codehooks security',
      'Stripe & Slack verification',
      'Automatic retries with exponential backoff',
      'Health monitoring and auto-disable'
    ],
    endpoints: {
      webhooks: '/webhooks',
      trigger: '/events/trigger/:eventType'
    },
    authentication: 'Secured by Codehooks built-in authentication'
  });
});

// Create a new webhook subscription
app.post('/webhooks', async (req, res) => {
  try {
    const { url, events, verificationType = 'stripe', metadata = {} } = req.body;

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: url and events array'
      });
    }

    // Validate URL format
    try {
      const parsedUrl = new URL(url);

      // Prevent SSRF attacks - block internal/private IPs
      const hostname = parsedUrl.hostname.toLowerCase();
      if (hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)) {
        return res.status(400).json({ error: 'Internal/private URLs not allowed' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Events can be anything - no validation needed
    // This allows maximum flexibility for any use case

    const verificationToken = generateVerificationToken();
    const secret = generateWebhookSecret();

    const webhook = {
      url,
      events,
      secret,
      verificationToken,
      verificationType,
      status: 'pending_verification',
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deliveryCount: 0,
      consecutiveFailures: 0
    };

    const db = await getWebhooksDB();
    const result = await db.insertOne(webhook);

    // Start verification process asynchronously
    setTimeout(async () => {
      const verified = await verifyWebhookUrl(url, verificationToken, verificationType);
      await db.updateOne(
        { _id: result._id },
        {
          $set: {
            status: verified ? 'active' : 'verification_failed',
            verifiedAt: verified ? new Date().toISOString() : null,
            updatedAt: new Date().toISOString()
          }
        }
      );
      console.log(`Webhook ${result._id} verification: ${verified ? 'SUCCESS' : 'FAILED'}`);
    }, 100);

    res.status(201).json({
      id: result._id,
      url,
      events,
      secret,
      status: 'pending_verification',
      verificationToken,
      verificationType,
      message: 'Webhook created. Verification in progress.'
    });
  } catch (error) {
    console.error('Error creating webhook:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// Get all webhooks
app.get('/webhooks', async (req, res) => {
  try {
    const { status, event } = req.query;
    const db = await getWebhooksDB();

    let query = {};
    if (status) query.status = status;
    if (event) query.events = event;

    const webhooks = await db.getMany(query).toArray();

    // Don't expose secrets in list view
    const sanitized = webhooks.map(({ secret, verificationToken, ...rest }) => rest);

    res.json({
      webhooks: sanitized,
      count: sanitized.length
    });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

// Get a specific webhook
app.get('/webhooks/:id', async (req, res) => {
  try {
    const db = await getWebhooksDB();
    const webhook = await db.getOne({ _id: req.params.id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json(webhook);
  } catch (error) {
    console.error('Error fetching webhook:', error);
    res.status(500).json({ error: 'Failed to fetch webhook' });
  }
});

// Update a webhook
app.patch('/webhooks/:id', async (req, res) => {
  try {
    const { url, events, status, metadata } = req.body;
    const db = await getWebhooksDB();

    const webhook = await db.getOne({ _id: req.params.id });
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const updates = { updatedAt: new Date().toISOString() };

    if (url && url !== webhook.url) {
      // If URL changed, need to re-verify
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      updates.url = url;
      updates.status = 'pending_verification';
      updates.verificationToken = generateVerificationToken();

      // Trigger re-verification
      setTimeout(async () => {
        const verified = await verifyWebhookUrl(
          url,
          updates.verificationToken,
          webhook.verificationType
        );
        await db.updateOne(
          { _id: req.params.id },
          {
            $set: {
              status: verified ? 'active' : 'verification_failed',
              verifiedAt: verified ? new Date().toISOString() : null,
              updatedAt: new Date().toISOString()
            }
          }
        );
      }, 100);
    }

    if (events) {
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: 'Events must be an array' });
      }
      updates.events = events;
    }

    if (status && ['active', 'disabled', 'paused'].includes(status)) {
      updates.status = status;
    }

    if (metadata) {
      updates.metadata = { ...webhook.metadata, ...metadata };
    }

    await db.updateOne({ _id: req.params.id }, { $set: updates });

    const updated = await db.getOne({ _id: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// Delete a webhook
app.delete('/webhooks/:id', async (req, res) => {
  try {
    const db = await getWebhooksDB();
    const webhook = await db.getOne({ _id: req.params.id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await db.removeOne({ _id: req.params.id });
    res.json({ message: 'Webhook deleted', id: req.params.id });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// Retry a failed webhook
app.post('/webhooks/:id/retry', async (req, res) => {
  try {
    const db = await getWebhooksDB();
    const webhook = await db.getOne({ _id: req.params.id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Reset failure count and status
    await db.updateOne(
      { _id: req.params.id },
      {
        $set: {
          consecutiveFailures: 0,
          status: webhook.status === 'disabled' ? 'active' : webhook.status,
          updatedAt: new Date().toISOString()
        }
      }
    );

    res.json({ message: 'Webhook reset and ready for retry', id: req.params.id });
  } catch (error) {
    console.error('Error retrying webhook:', error);
    res.status(500).json({ error: 'Failed to retry webhook' });
  }
});

// Get webhook delivery statistics
app.get('/webhooks/:id/stats', async (req, res) => {
  try {
    const db = await getWebhooksDB();
    const webhook = await db.getOne({ _id: req.params.id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json({
      id: webhook._id,
      deliveryCount: webhook.deliveryCount || 0,
      consecutiveFailures: webhook.consecutiveFailures || 0,
      lastDeliveryAt: webhook.lastDeliveryAt || null,
      lastDeliveryStatus: webhook.lastDeliveryStatus || null,
      lastDeliveryError: webhook.lastDeliveryError || null,
      status: webhook.status
    });
  } catch (error) {
    console.error('Error fetching webhook stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Trigger an event (sends to all matching webhooks via queue)
app.post('/events/trigger/:eventType', async (req, res) => {
  try {
    const { eventType } = req.params;
    const eventData = {
      id: crypto.randomUUID(),
      type: eventType,
      data: req.body,
      created: Math.floor(Date.now() / 1000)
    };

    // Store event in database for audit trail
    const eventsDB = await getEventsDB();
    await eventsDB.insertOne({
      ...eventData,
      processedAt: new Date().toISOString()
    });

    // Efficiently queue all matching webhooks using enqueueFromQuery
    const conn = await Datastore.open();
    const result = await conn.enqueueFromQuery(
      'webhooks', // collection
      {
        status: 'active',
        $or: [{ events: eventType }, { events: '*' }]
      }, // query
      'webhook-delivery', // topic/queue name
      {
        eventData: eventData, // Additional data to include in queue message
        retries: 3,
        retryDelay: 1000, // 1 second initial delay
        timeout: 30000 // 30 second timeout per delivery
      }
    );

    if (result.queued === 0) {
      return res.json({
        message: 'Event received but no active webhooks subscribed',
        eventType,
        eventId: eventData.id
      });
    }

    res.status(202).json({
      message: 'Event accepted for delivery',
      eventType,
      eventId: eventData.id,
      webhookCount: result.queued,
      queuedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering event:', error);
    res.status(500).json({ error: 'Failed to trigger event' });
  }
});

// Worker function: Process webhook deliveries from queue
async function webhookDeliveryWorker(req, res) {
  try {
    const { payload } = req.body;

    // Payload structure from enqueueFromQuery:
    // - payload.event: The webhook document from the collection
    // - payload.eventData: Our custom event data passed in options
    const webhook = payload.event;
    const eventData = payload.eventData;

    if (!webhook || !eventData) {
      console.error('Invalid worker payload: missing webhook or eventData');
      return res.status(400).json({ error: 'Missing webhook or event data' });
    }

    const eventPayload = JSON.stringify(eventData);
    const { signature, timestamp } = generateSignature(eventPayload, webhook.secret);

    console.log(`Sending webhook ${webhook._id} for event ${eventData.type}`);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp.toString(),
        'X-Webhook-Id': webhook._id,
        'X-Event-Id': eventData.id,
        'User-Agent': 'Codehooks-Webhook/2.0'
      },
      body: eventPayload,
      signal: AbortSignal.timeout(10000) // 10 second timeout per attempt
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Update webhook with successful delivery
    const db = await getWebhooksDB();
    await db.updateOne(
      { _id: webhook._id },
      {
        $set: {
          lastDeliveryAt: new Date().toISOString(),
          lastDeliveryStatus: 'success',
          lastDeliveryError: null,
          consecutiveFailures: 0,
          updatedAt: new Date().toISOString()
        },
        $inc: { deliveryCount: 1 }
      }
    );

    console.log(`✅ Webhook ${webhook._id} delivered successfully`);

    // Return success
    res.json({ success: true, webhook: webhook._id });

  } catch (error) {
    console.error(`❌ Webhook delivery failed:`, error.message);

    const webhook = req.body.payload?.event;
    if (webhook) {
      const consecutiveFailures = (webhook.consecutiveFailures || 0) + 1;

      // Update webhook with failure info
      const db = await getWebhooksDB();
      const updateData = {
        lastDeliveryAt: new Date().toISOString(),
        lastDeliveryStatus: 'failed',
        lastDeliveryError: error.message,
        consecutiveFailures,
        updatedAt: new Date().toISOString()
      };

      // Disable webhook after too many consecutive failures
      if (consecutiveFailures >= 10) {
        updateData.status = 'disabled';
        updateData.disabledReason = 'Too many consecutive failures';
        console.log(`🚫 Webhook ${webhook._id} disabled after 10 failures`);
      }

      await db.updateOne({ _id: webhook._id }, { $set: updateData });
    }

    // Return error to trigger retry
    res.status(500).json({ error: error.message, webhook: webhook?._id });
  }
}

// Register the worker
app.worker('webhook-delivery', webhookDeliveryWorker);

// Cron job to clean up old events and failed webhooks (runs daily)
cron('0 0 * * *', async () => {
  try {
    console.log('🧹 Running cleanup job...');

    const webhooksDB = await getWebhooksDB();
    const eventsDB = await getEventsDB();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    // Disable webhooks that have been failing for 30 days
    const disabledResult = await webhooksDB.updateMany(
      {
        status: 'verification_failed',
        createdAt: { $lt: thirtyDaysAgoISO }
      },
      {
        $set: {
          status: 'disabled',
          disabledReason: 'Verification failed for 30 days',
          updatedAt: new Date().toISOString()
        }
      }
    );

    // Clean up old events (keep 90 days of audit trail)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoISO = ninetyDaysAgo.toISOString();

    const eventsResult = await eventsDB.removeMany({
      processedAt: { $lt: ninetyDaysAgoISO }
    });

    console.log(`✅ Cleanup complete: ${disabledResult || 0} webhooks disabled, ${eventsResult || 0} old events removed`);
  } catch (error) {
    console.error('Error in cleanup cron:', error);
  }
});

export default app.init();
