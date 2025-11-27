import { app, Datastore } from 'codehooks-js';
import crypto from 'crypto';
import { URL } from 'url';
import https from 'https';
import http from 'http';

// Database connection helper
const getDB = async () => {
  return await Datastore.open();
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

// Helper function: Make HTTP request using native Node.js modules
function makeHttpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 10000
    };

    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', (error) => reject(error));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
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

      const response = await makeHttpRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Codehooks-Webhook/1.0',
          'Content-Length': Buffer.byteLength(testPayload)
        },
        timeout: 10000
      }, testPayload);

      return response.statusCode >= 200 && response.statusCode < 300;
    } else if (verificationType === 'slack') {
      // Slack-style: Send challenge parameter
      const challenge = crypto.randomBytes(16).toString('hex');
      const testPayload = JSON.stringify({
        type: 'url_verification',
        challenge: challenge,
        token: verificationToken
      });

      const response = await makeHttpRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Codehooks-Webhook/1.0',
          'Content-Length': Buffer.byteLength(testPayload)
        },
        timeout: 10000
      }, testPayload);

      if (response.statusCode < 200 || response.statusCode >= 300) return false;

      try {
        const responseData = JSON.parse(response.body);
        return responseData.challenge === challenge;
      } catch {
        return false;
      }
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

// Create or update webhook subscription
app.post('/webhooks', async (req, res) => {
  try {
    const { url, events, verificationType = 'stripe', metadata = {}, clientId } = req.body;

    // Debug logging
    console.log('Received webhook registration request:', {
      url: url,
      urlType: typeof url,
      urlValue: JSON.stringify(url),
      events,
      clientId,
      fullBody: JSON.stringify(req.body)
    });

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: url and events array'
      });
    }

    if (!clientId) {
      return res.status(400).json({
        error: 'Missing required field: clientId (unique identifier for the webhook listener)'
      });
    }

    // Validate URL format
    try {
      console.log('Attempting to parse URL:', url);
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
    } catch (urlError) {
      console.error('URL parsing error:', urlError.message, 'for URL:', url);
      return res.status(400).json({
        error: 'Invalid URL format',
        details: urlError.message,
        receivedUrl: url
      });
    }

    // Events can be anything - no validation needed
    // This allows maximum flexibility for any use case

    console.log('Getting database connection...');
    const conn = await getDB();
    console.log('Database connection obtained');

    // Check if webhook with this clientId and URL already exists
    console.log('Checking for existing webhook with clientId:', clientId, 'and url:', url);
    let existingWebhook = null;
    try {
      existingWebhook = await conn.getOne('webhooks', { clientId, url });
      console.log('Existing webhook check result:', existingWebhook ? 'Found' : 'Not found');
    } catch (findError) {
      // Collection might not exist yet, that's ok - treat as no existing webhook
      console.log('getOne error (likely collection does not exist yet):', findError.message);
      existingWebhook = null;
    }

    const verificationToken = generateVerificationToken();
    const secret = existingWebhook?.secret || generateWebhookSecret(); // Keep existing secret if updating
    const now = new Date().toISOString();

    let webhookId;
    let isUpdate = false;

    if (existingWebhook) {
      // Update existing webhook
      console.log('Updating existing webhook:', existingWebhook._id);
      await conn.updateOne(
        'webhooks',
        { _id: existingWebhook._id },
        {
          $set: {
            url,
            events,
            secret,
            verificationToken,
            verificationType,
            status: 'pending_verification',
            metadata,
            clientId,
            updatedAt: now
          }
        }
      );
      webhookId = existingWebhook._id;
      isUpdate = true;
    } else {
      // Create new webhook
      console.log('Creating new webhook');
      const webhookData = {
        url,
        events,
        secret,
        verificationToken,
        verificationType,
        status: 'pending_verification',
        metadata,
        clientId,
        createdAt: now,
        updatedAt: now,
        deliveryCount: 0,
        consecutiveFailures: 0
      };

      const result = await conn.insertOne('webhooks', webhookData);
      webhookId = result._id;
      console.log('Created webhook with ID:', webhookId);
    }

    // Queue webhook verification using worker
    await conn.enqueue(
      'webhook-verification',
      {
        webhookId,
        url,
        verificationToken,
        verificationType
      },
      {
        retries: 2,
        retryDelay: 1000
      }
    );

    res.status(isUpdate ? 200 : 201).json({
      id: webhookId,
      url,
      events,
      secret,
      clientId,
      status: 'pending_verification',
      verificationToken,
      verificationType,
      message: isUpdate
        ? 'Webhook updated. Verification in progress.'
        : 'Webhook created. Verification in progress.'
    });
  } catch (error) {
    console.error('Error creating/updating webhook:', error);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    res.status(500).json({
      error: 'Failed to create/update webhook',
      details: error.message,
      errorType: error.constructor.name
    });
  }
});

// Get all webhooks
app.get('/webhooks', async (req, res) => {
  try {
    const { status, event } = req.query;
    const conn = await getDB();

    let query = {};
    if (status) query.status = status;
    if (event) query.events = event;

    const webhooks = await conn.getMany('webhooks', query).toArray();

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
    const conn = await getDB();
    const webhook = await conn.getOne('webhooks', { _id: req.params.id });

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
    const conn = await getDB();

    const webhook = await conn.getOne('webhooks', { _id: req.params.id });
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const updates = { updatedAt: new Date().toISOString() };

    if (url && url !== webhook.url) {
      // If URL changed, need to re-verify
      try {
        console.log('Validating new URL in PATCH:', url);
        new URL(url);
      } catch (urlError) {
        console.error('URL parsing error in PATCH:', urlError.message, 'for URL:', url);
        return res.status(400).json({
          error: 'Invalid URL format',
          details: urlError.message,
          receivedUrl: url
        });
      }
      updates.url = url;
      updates.status = 'pending_verification';
      updates.verificationToken = generateVerificationToken();

      // Queue re-verification using worker
      await conn.enqueue(
        'webhook-verification',
        {
          webhookId: req.params.id,
          url,
          verificationToken: updates.verificationToken,
          verificationType: webhook.verificationType
        },
        {
          retries: 2,
          retryDelay: 1000
        }
      );
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

    await conn.updateOne('webhooks', { _id: req.params.id }, { $set: updates });

    const updated = await conn.getOne('webhooks', { _id: req.params.id });
    res.json(updated);
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// Delete a webhook
app.delete('/webhooks/:id', async (req, res) => {
  try {
    const conn = await getDB();
    const webhook = await conn.getOne('webhooks', { _id: req.params.id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    await conn.removeOne('webhooks', { _id: req.params.id });
    res.json({ message: 'Webhook deleted', id: req.params.id });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// Retry a failed webhook
app.post('/webhooks/:id/retry', async (req, res) => {
  try {
    const conn = await getDB();
    const webhook = await conn.getOne('webhooks', { _id: req.params.id });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Reset failure count and status
    await conn.updateOne(
      'webhooks',
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
    const conn = await getDB();
    const webhook = await conn.getOne('webhooks', { _id: req.params.id });

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
    const conn = await getDB();
    await conn.insertOne('events', {
      ...eventData,
      processedAt: new Date().toISOString()
    });

    // Update all matching webhooks with the current eventId to process
    // This allows enqueueFromQuery to work while preserving event data
    console.log(`Looking for active webhooks matching event type: ${eventType}`);
    const updateResult = await conn.updateMany(
      'webhooks',
      {
        status: 'active',
        $or: [{ events: eventType }, { events: '*' }]
      },
      {
        $set: {
          pendingEventId: eventData.id,
          pendingEventType: eventType
        }
      }
    );

    console.log('updateMany result:', JSON.stringify(updateResult, null, 2));
    const matchedCount = updateResult.count || updateResult.modifiedCount || updateResult.matchedCount || 0;

    if (matchedCount === 0) {
      console.log(`No active webhooks found for event type: ${eventType}`);
      return res.json({
        message: 'Event received but no active webhooks subscribed',
        eventType,
        eventId: eventData.id
      });
    }

    console.log(`Found ${matchedCount} active webhook(s) for event ${eventType}`);

    // Efficiently queue all matching webhooks using enqueueFromQuery
    const result = await conn.enqueueFromQuery(
      'webhooks',
      {
        status: 'active',
        pendingEventId: eventData.id
      },
      'webhook-delivery'
    );

    res.status(202).json({
      message: 'Event accepted for delivery',
      eventType,
      eventId: eventData.id,
      webhookCount: result.count || matchedCount,
      queuedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error triggering event:', error);
    res.status(500).json({ error: 'Failed to trigger event' });
  }
});

// Helper function: Deliver webhook with event data
async function deliverWebhook(webhook, eventData) {
  const eventPayload = JSON.stringify(eventData);
  const { signature, timestamp } = generateSignature(eventPayload, webhook.secret);

  console.log(`Sending webhook ${webhook._id} for event ${eventData.type}`);

  const response = await makeHttpRequest(webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestamp.toString(),
      'X-Webhook-Id': webhook._id,
      'X-Event-Id': eventData.id,
      'User-Agent': 'Codehooks-Webhook/2.0',
      'Content-Length': Buffer.byteLength(eventPayload)
    },
    timeout: 10000
  }, eventPayload);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
  }
}

// Worker function: Process webhook deliveries from queue
async function webhookDeliveryWorker(req, res) {
  try {
    const { payload } = req.body;

    // Payload structure from enqueueFromQuery:
    // - payload IS the webhook document
    const webhook = payload;

    if (!webhook || !webhook.pendingEventId) {
      console.error('Invalid worker payload: missing webhook or pendingEventId');
      console.error('Received payload:', JSON.stringify(payload, null, 2));
      return res.status(400).json({ error: 'Missing webhook or event data' });
    }

    // Look up the event data from the events collection
    const conn = await getDB();
    const eventDoc = await conn.getOne('events', { id: webhook.pendingEventId });

    if (!eventDoc) {
      console.error(`Event ${webhook.pendingEventId} not found for webhook ${webhook._id}`);
      return res.status(400).json({ error: 'Event not found' });
    }

    // Deliver the webhook
    await deliverWebhook(webhook, eventDoc);

    // Update webhook with successful delivery and clear pendingEventId
    const conn2 = await getDB();
    await conn2.updateOne(
      'webhooks',
      { _id: webhook._id },
      {
        $set: {
          lastDeliveryAt: new Date().toISOString(),
          lastDeliveryStatus: 'success',
          lastDeliveryError: null,
          consecutiveFailures: 0,
          pendingEventId: null,
          pendingEventType: null,
          updatedAt: new Date().toISOString()
        },
        $inc: { deliveryCount: 1 }
      }
    );

    console.log(`✅ Webhook ${webhook._id} delivered successfully`);

    // Return success - workers use res.end()
    res.end(JSON.stringify({ success: true, webhook: webhook._id }));

  } catch (error) {
    console.error(`❌ Webhook delivery failed:`, error.message);

    const webhook = req.body.payload;
    if (webhook) {
      const consecutiveFailures = (webhook.consecutiveFailures || 0) + 1;

      // Update webhook with failure info and clear pendingEventId
      const conn = await getDB();
      const updateData = {
        lastDeliveryAt: new Date().toISOString(),
        lastDeliveryStatus: 'failed',
        lastDeliveryError: error.message,
        consecutiveFailures,
        pendingEventId: null,
        pendingEventType: null,
        updatedAt: new Date().toISOString()
      };

      // Disable webhook after too many consecutive failures
      if (consecutiveFailures >= 10) {
        updateData.status = 'disabled';
        updateData.disabledReason = 'Too many consecutive failures';
        console.log(`🚫 Webhook ${webhook._id} disabled after 10 failures`);
      }

      await conn.updateOne('webhooks', { _id: webhook._id }, { $set: updateData });
    }

    // Return error to trigger retry - workers use res.end()
    res.status(500).end(JSON.stringify({ error: error.message, webhook: webhook?._id }));
  }
}

// Worker function: Process webhook verification from queue
async function webhookVerificationWorker(req, res) {
  try {
    const { payload } = req.body;
    const { webhookId, url, verificationToken, verificationType } = payload;

    if (!webhookId || !url || !verificationToken) {
      console.error('Invalid verification worker payload:', payload);
      return res.status(400).json({ error: 'Missing required verification data' });
    }

    console.log(`Verifying webhook ${webhookId}...`);

    // Perform verification
    const verified = await verifyWebhookUrl(url, verificationToken, verificationType);

    // Update webhook with verification result
    const conn = await getDB();
    await conn.updateOne(
      'webhooks',
      { _id: webhookId },
      {
        $set: {
          status: verified ? 'active' : 'verification_failed',
          verifiedAt: verified ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString()
        }
      }
    );

    console.log(`✅ Webhook ${webhookId} verification: ${verified ? 'SUCCESS' : 'FAILED'}`);
    res.end(JSON.stringify({ success: true, verified, webhookId }));

  } catch (error) {
    console.error('❌ Webhook verification error:', error.message);

    // Mark verification as failed
    const { webhookId } = req.body.payload || {};
    if (webhookId) {
      try {
        const conn = await getDB();
        await conn.updateOne(
          'webhooks',
          { _id: webhookId },
          {
            $set: {
              status: 'verification_failed',
              verifiedAt: null,
              updatedAt: new Date().toISOString()
            }
          }
        );
      } catch (updateError) {
        console.error('Failed to update webhook status:', updateError);
      }
    }

    res.status(500).end(JSON.stringify({ error: error.message, webhookId }));
  }
}

// Register workers
app.worker('webhook-verification', webhookVerificationWorker);
app.worker('webhook-delivery', webhookDeliveryWorker);

// Cron job to retry failed webhooks (runs every 30 minutes)
app.job('*/30 * * * *', retryFailedWebhooks);

async function retryFailedWebhooks(_req, res) {
  try {
    console.log('🔄 Running failed webhook retry job...');

    const conn = await Datastore.open();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Retry webhooks that:
    // - Have consecutive failures (1-9, not disabled yet)
    // - Last delivery was more than 1 hour ago (to avoid hammering failing endpoints)
    // - Are still active
    const result = await conn.enqueueFromQuery(
      'webhooks',
      {
        status: 'active',
        consecutiveFailures: { $gte: 1, $lt: 10 },
        lastDeliveryAt: { $lt: oneHourAgo.toISOString() }
      },
      'webhook-retry', // Separate queue for retries
      {
        isRetry: true,
        retries: 2, // Fewer retries for already-failed webhooks
        retryDelay: 2000,
        timeout: 30000
      }
    );

    console.log(`✅ Retry job complete: ${result.queued || 0} failed webhooks queued for retry`);

    res.end();
  } catch (error) {
    console.error('Error in retry job:', error);
    res.status(500).end();
  }
}

// Worker for webhook retries (uses same delivery logic)
app.worker('webhook-retry', async (req, res) => {
  try {
    // When using enqueueFromQuery, payload IS the webhook document
    const webhook = req.body.payload;

    if (!webhook) {
      console.error('❌ Retry worker: No webhook in payload');
      return res.status(400).end();
    }

    console.log(`🔄 Retrying webhook ${webhook._id} (failures: ${webhook.consecutiveFailures})`);

    // Use the latest event for this webhook's subscribed events
    const conn = await getDB();
    const latestEventCursor = await conn.getMany(
      'events',
      { type: { $in: webhook.events.includes('*') ? ['*'] : webhook.events } },
      { sort: { processedAt: -1 }, limit: 1 }
    );
    const latestEvents = await latestEventCursor.toArray();
    const latestEvent = latestEvents.length > 0 ? latestEvents[0] : null;

    if (!latestEvent) {
      console.log(`⚠️ No events found for webhook ${webhook._id} retry, skipping`);
      return res.end();
    }

    // Deliver the webhook with the latest event
    await deliverWebhook(webhook, latestEvent);

    // Update webhook on success
    const conn2 = await getDB();
    await conn2.updateOne(
      'webhooks',
      { _id: webhook._id },
      {
        $set: {
          lastDeliveryAt: new Date().toISOString(),
          lastDeliveryStatus: 'success',
          consecutiveFailures: 0, // Reset failures on successful retry
          updatedAt: new Date().toISOString()
        },
        $inc: { deliveryCount: 1 }
      }
    );

    console.log(`✅ Webhook ${webhook._id} retry successful, failures reset`);
    res.end();

  } catch (error) {
    console.error(`❌ Webhook retry failed:`, error.message);

    const webhook = req.body.payload;
    if (webhook) {
      const consecutiveFailures = (webhook.consecutiveFailures || 0) + 1;

      const conn = await getDB();
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

      await conn.updateOne(
        'webhooks',
        { _id: webhook._id },
        { $set: updateData }
      );
    }

    res.status(500).end();
  }
});

// Cron job to clean up old events and failed webhooks (runs daily at midnight)
app.job('0 0 * * *', cleanupJob);

async function cleanupJob(_req, res) {
  try {
    console.log('🧹 Running cleanup job...');

    const conn = await getDB();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    // Disable webhooks that have been failing for 30 days
    const disabledResult = await conn.updateMany(
      'webhooks',
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

    const eventsResult = await conn.removeMany('events', {
      processedAt: { $lt: ninetyDaysAgoISO }
    });

    console.log(`✅ Cleanup complete: ${disabledResult || 0} webhooks disabled, ${eventsResult || 0} old events removed`);

    res.end();
  } catch (error) {
    console.error('Error in cleanup cron:', error);
    res.status(500).end();
  }
}

export default app.init();
