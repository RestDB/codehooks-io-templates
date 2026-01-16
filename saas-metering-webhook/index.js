/*
 * SaaS Metering Webhook System
 * Codehooks.io template for tracking usage metrics with batch aggregation
 *
 * Features:
 * - Multi-tenant event capture with time period indexing
 * - Batch aggregation using Codehooks aggregation API
 * - Flexible period aggregation (hourly, daily, weekly, monthly, yearly)
 * - Multiple aggregation operations (sum, avg, min, max, count, first, last)
 * - Webhook delivery with HMAC signing
 * - Cron-based batch processing
 */

import { app, Datastore } from 'codehooks-js';
// Note: aggregation function not yet implemented, using manual approach
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import systemConfig from './systemconfig.json' assert { type: 'json' };

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get ISO week number
 * @param {Date} date - Date object
 * @returns {string} ISO week number as YYYYWW
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}${String(weekNo).padStart(2, '0')}`;
}

/**
 * Calculate time period strings for an event
 * @param {Date} timestamp - Event timestamp
 * @returns {Object} Time period strings
 */
function calculateTimePeriods(timestamp) {
  const year = timestamp.getUTCFullYear();
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getUTCDate()).padStart(2, '0');
  const hour = String(timestamp.getUTCHours()).padStart(2, '0');
  const minute = String(timestamp.getUTCMinutes()).padStart(2, '0');

  return {
    minute: `${year}${month}${day}${hour}${minute}`,
    hour: `${year}${month}${day}${hour}`,
    day: `${year}${month}${day}`,
    week: getISOWeek(timestamp),
    month: `${year}${month}`,
    year: `${year}`
  };
}

/**
 * Calculate period boundaries for querying
 * @param {string} periodType - hourly, daily, weekly, monthly, yearly
 * @param {Date} now - Current date/time
 * @returns {{periodStart: Date, periodEnd: Date, periodKey: string}}
 */
function calculatePeriodBounds(periodType, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  let periodStart, periodEnd, periodKey;

  switch (periodType) {
    case 'hourly':
      periodStart = new Date(Date.UTC(year, month, date, hour, 0, 0, 0));
      periodEnd = new Date(periodStart.getTime() + 3600000 - 1);
      periodKey = `${year}${String(month + 1).padStart(2, '0')}${String(date).padStart(2, '0')}${String(hour).padStart(2, '0')}`;
      break;

    case 'daily':
      periodStart = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
      periodEnd = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));
      periodKey = `${year}${String(month + 1).padStart(2, '0')}${String(date).padStart(2, '0')}`;
      break;

    case 'weekly':
      const mondayOffset = day === 0 ? -6 : 1 - day;
      periodStart = new Date(Date.UTC(year, month, date + mondayOffset, 0, 0, 0, 0));
      periodEnd = new Date(periodStart.getTime() + 7 * 86400000 - 1);
      periodKey = getISOWeek(periodStart);
      break;

    case 'monthly':
      periodStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      periodEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      periodKey = `${year}${String(month + 1).padStart(2, '0')}`;
      break;

    case 'yearly':
      periodStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      periodEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
      periodKey = `${year}`;
      break;

    default:
      throw new Error(`Invalid period type: ${periodType}`);
  }

  return { periodStart, periodEnd, periodKey };
}

/**
 * Perform aggregation for an event type using Codehooks aggregation API
 * @param {Object} conn - Database connection
 * @param {string} customerId - Customer ID
 * @param {string} eventType - Event type
 * @param {string} periodType - Period type (hourly, daily, etc.)
 * @param {string} periodKey - Period key for filtering
 * @param {string} op - Operation (sum, avg, min, max, count, first, last)
 * @returns {Promise<{value: number, count: number}>}
 */
async function performAggregation(conn, customerId, eventType, periodType, periodKey, op) {
  const periodField = periodType === 'hourly' ? 'hour' : periodType === 'daily' ? 'day' : periodType === 'weekly' ? 'week' : periodType === 'monthly' ? 'month' : 'year';

  const query = {
    customerId,
    eventType,
    [periodField]: periodKey
  };

  // Handle count operation
  if (op === 'count') {
    const events = await conn.getMany('events', query).toArray();
    return {
      value: events.length,
      count: events.length
    };
  }

  // Handle first/last operations (need to manually sort and pick)
  if (op === 'first' || op === 'last') {
    const events = await conn.getMany('events', query, {
      sort: { receivedAt: op === 'first' ? 1 : -1 },
      limit: 1
    }).toArray();

    if (events.length > 0) {
      const totalCount = await conn.getMany('events', query).toArray();
      return {
        value: events[0].value,
        count: totalCount.length
      };
    }
    return null;
  }

  // Handle sum, avg, min, max using manual aggregation
  const events = await conn.getMany('events', query).toArray();

  if (events.length === 0) {
    return null;
  }

  let value;
  switch (op) {
    case 'sum':
      value = events.reduce((sum, e) => sum + e.value, 0);
      break;
    case 'avg':
      value = events.reduce((sum, e) => sum + e.value, 0) / events.length;
      break;
    case 'min':
      value = Math.min(...events.map(e => e.value));
      break;
    case 'max':
      value = Math.max(...events.map(e => e.value));
      break;
    default:
      throw new Error(`Unknown operation: ${op}`);
  }

  return {
    value,
    count: events.length
  };
}

/**
 * Generate HMAC-SHA256 signature for webhook payload
 * @param {string} payload - JSON payload string
 * @param {string} secret - Webhook secret
 * @returns {{signature: string, timestamp: number}}
 */
function generateSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sigBasestring = `${timestamp}.${payload}`;
  const signature = 'v1=' + crypto
    .createHmac('sha256', secret)
    .update(sigBasestring, 'utf8')
    .digest('hex');
  return { signature, timestamp };
}

/**
 * Make HTTP request (for webhook delivery)
 * @param {string} url - Target URL
 * @param {Object} options - Request options
 * @param {string} body - Request body
 * @returns {Promise<{statusCode: number, statusMessage: string, body: string}>}
 */
function makeHttpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method,
      headers: options.headers,
      timeout: options.timeout || 10000
    };

    const req = client.request(requestOptions, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          body: responseBody
        });
      });
    });

    req.on('error', reject);
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

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Simple test endpoint
 */
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Health check and API documentation
 */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SaaS Metering System',
    version: '2.0.0',
    description: 'Multi-tenant usage metering with batch aggregation and webhook delivery',
    features: [
      'Multi-tenant event capturing with time indexing',
      'Batch aggregation using Codehooks aggregation API',
      'Flexible period aggregation (hourly/daily/weekly/monthly/yearly)',
      'Multiple aggregation operations (sum, avg, min, max, count, first, last)',
      'Webhook delivery with HMAC-SHA256 signing',
      'Cron-based batch processing'
    ],
    endpoints: {
      capture: 'POST /usage/:eventType',
      captureBatch: 'POST /usagebatch',
      config: 'GET /config',
      management: {
        events: 'GET /events',
        aggregations: 'GET /aggregations'
      }
    },
    configuration: 'Edit systemconfig.json file and redeploy',
    documentation: 'See README.md for complete API documentation'
  });
});

/**
 * Capture multiple usage events in batch
 * POST /usagebatch
 * Body: [{ eventType, customerId, value, metadata? }, ...]
 */
app.post('/usagebatch', async (req, res) => {
  const events = req.body;

  // Validate input is an array
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'Request body must be an array of events' });
  }

  if (events.length === 0) {
    return res.status(400).json({ error: 'Events array cannot be empty' });
  }

  // Validate each event and collect errors
  const validationErrors = [];
  const validEvents = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const errors = [];

    if (!event.eventType) {
      errors.push('eventType is required');
    } else if (!systemConfig.events[event.eventType]) {
      errors.push(`Invalid event type: ${event.eventType}. Must be one of: ${Object.keys(systemConfig.events).join(', ')}`);
    }

    if (!event.customerId) {
      errors.push('customerId is required');
    }

    if (typeof event.value !== 'number') {
      errors.push('value must be a number');
    }

    if (errors.length > 0) {
      validationErrors.push({ index: i, errors });
    } else {
      validEvents.push(event);
    }
  }

  // If there are validation errors, return them
  if (validationErrors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed for some events',
      validationErrors,
      validCount: validEvents.length,
      invalidCount: validationErrors.length
    });
  }

  try {
    const conn = await Datastore.open();
    const timestamp = new Date();
    const timePeriods = calculateTimePeriods(timestamp);

    // Store all events
    const insertedCount = await Promise.all(
      validEvents.map(event =>
        conn.insertOne('events', {
          eventType: event.eventType,
          customerId: event.customerId,
          value: event.value,
          metadata: event.metadata || {},
          receivedAt: timestamp.toISOString(),
          ...timePeriods
        })
      )
    );

    res.status(201).json({
      message: 'Events captured',
      count: insertedCount.length
    });
  } catch (error) {
    console.error('❌ [API] Error storing batch events:', error);
    res.status(500).json({ error: 'Failed to store events' });
  }
});

/**
 * Capture usage event
 * POST /usage/:eventType
 * Body: { customerId, value, metadata? }
 */
app.post('/usage/:eventType', async (req, res) => {
  const { eventType } = req.params;
  const { customerId, value, metadata = {} } = req.body;

  // Validation
  if (!systemConfig.events[eventType]) {
    return res.status(400).json({
      error: `Invalid event type: ${eventType}. Must be one of: ${Object.keys(systemConfig.events).join(', ')}`
    });
  }
  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
  }
  if (typeof value !== 'number') {
    return res.status(400).json({ error: 'value must be a number' });
  }

  try {
    const conn = await Datastore.open();
    const timestamp = new Date();
    const timePeriods = calculateTimePeriods(timestamp);

    // Store event with time period fields
    await conn.insertOne('events', {
      eventType,
      customerId,
      value,
      metadata,
      receivedAt: timestamp.toISOString(),
      ...timePeriods
    });

    res.status(201).json({
      message: 'Event captured',
      eventType,
      customerId
    });
  } catch (error) {
    console.error('❌ [API] Error storing event:', error);
    res.status(500).json({ error: 'Failed to store event' });
  }
});

/**
 * Get system configuration
 * GET /config
 */
app.get('/config', (req, res) => {
  res.json(systemConfig);
});

/**
 * Query events
 * GET /events?customerId=xxx&eventType=yyy&from=timestamp&to=timestamp&limit=100
 */
app.get('/events', async (req, res) => {
  const { customerId, eventType, from, to, limit = 100 } = req.query;

  const query = {};
  if (customerId) query.customerId = customerId;
  if (eventType) query.eventType = eventType;
  if (from || to) {
    query.receivedAt = {};
    if (from) query.receivedAt.$gte = from;
    if (to) query.receivedAt.$lte = to;
  }

  try {
    const conn = await Datastore.open();
    conn.getMany('events', query, {
      sort: { receivedAt: -1 },
      limit: parseInt(limit)
    }).json(res);
  } catch (error) {
    console.error('❌ [API] Error querying events:', error);
    res.status(500).json({ error: 'Failed to query events' });
  }
});

/**
 * Trigger aggregation manually (for testing)
 * POST /aggregations/trigger
 */
app.post('/aggregations/trigger', async (req, res) => {
  console.log('🔄 [Manual] Triggering batch aggregation...');

  try {
    const conn = await Datastore.open();
    const now = new Date();
    const { periods, events: eventOps, webhooks } = systemConfig;

    // Get all unique customers
    const allEvents = await conn.getMany('events', {}).toArray();
    const uniqueCustomers = [...new Set(allEvents.map(e => e.customerId))];

    let aggregationCount = 0;

    // Process each customer
    for (const customerId of uniqueCustomers) {
      // Process each configured period
      for (const periodType of periods) {
        // For testing, process the current period even if not complete
        const { periodStart, periodEnd, periodKey } = calculatePeriodBounds(periodType, now);

        // Check if period is complete
        const isPeriodComplete = now >= periodEnd;

        // Check if we've already aggregated this period
        const existingAgg = await conn.getOne('aggregations', `${customerId}_${periodType}_${periodKey}`);

        if (existingAgg) {
          if (isPeriodComplete) {
            // Period is complete and already aggregated - skip it
            console.log(`✅ [Manual] Skipping ${periodType} aggregation for ${customerId} (${periodKey}) - complete and already exists`);
            continue;
          } else {
            // Period is incomplete - delete and recreate with latest data
            await conn.removeOne('aggregations', `${customerId}_${periodType}_${periodKey}`);
            console.log(`🔄 [Manual] Deleting incomplete ${periodType} aggregation for ${customerId} (${periodKey}) to recreate with latest data`);
          }
        }

        // Aggregate each event type
        const aggregatedEvents = {};
        const eventCounts = {};

        for (const [eventType, config] of Object.entries(eventOps)) {
          try {
            const result = await performAggregation(
              conn,
              customerId,
              eventType,
              periodType,
              periodKey,
              config.op
            );

            if (result && result.value !== null && result.value !== undefined) {
              aggregatedEvents[eventType] = result.value;
              eventCounts[eventType] = result.count;
            }
          } catch (error) {
            console.error(`❌ [Manual] Error aggregating ${eventType} for ${customerId}:`, error);
          }
        }

        // Only create aggregation if we have data
        if (Object.keys(aggregatedEvents).length > 0) {
          const aggregation = {
            _id: `${customerId}_${periodType}_${periodKey}`,
            customerId,
            period: periodType,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            periodKey,
            timestamp: now.toISOString(),
            events: aggregatedEvents,
            eventCounts,
            webhookStatus: {
              delivered: false,
              attempts: 0
            }
          };

          await conn.insertOne('aggregations', aggregation);
          aggregationCount++;

          console.log(`✅ [Manual] Created ${periodType} aggregation for ${customerId} (${periodKey})`);

          // Queue webhook deliveries ONLY for completed periods
          if (isPeriodComplete && webhooks && webhooks.length > 0) {
            for (const webhook of webhooks) {
              if (webhook.enabled) {
                await conn.enqueue('deliver-aggregation-webhook', {
                  aggregationId: aggregation._id,
                  webhookUrl: webhook.url,
                  webhookSecret: webhook.secret,
                  customerId,
                  period: periodType
                });
                console.log(`📤 [Manual] Queued webhook to ${webhook.url} for completed period`);
              }
            }
          } else if (!isPeriodComplete) {
            console.log(`⏭️  [Manual] Skipping webhook for incomplete ${periodType} period (${periodKey})`);
          }
        }
      }
    }

    res.json({
      message: 'Aggregation triggered',
      aggregationsCreated: aggregationCount
    });
  } catch (error) {
    console.error('❌ [Manual] Fatal error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Query aggregations
 * GET /aggregations?customerId=xxx&period=daily&from=timestamp&to=timestamp&limit=100
 */
app.get('/aggregations', async (req, res) => {
  const { customerId, period, from, to, limit = 100 } = req.query;

  const query = {};
  if (customerId) query.customerId = customerId;
  if (period) query.period = period;
  if (from || to) {
    query.periodStart = {};
    if (from) query.periodStart.$gte = from;
    if (to) query.periodStart.$lte = to;
  }

  try {
    const conn = await Datastore.open();
    conn.getMany('aggregations', query, {
      sort: { periodStart: -1 },
      limit: parseInt(limit)
    }).json(res);
  } catch (error) {
    console.error('❌ [API] Error querying aggregations:', error);
    res.status(500).json({ error: 'Failed to query aggregations' });
  }
});

// ============================================================================
// WORKERS
// ============================================================================

/**
 * Deliver aggregation webhook worker
 */
app.worker('deliver-aggregation-webhook', async (req, res) => {
  const { payload } = req.body;
  const { aggregationId, webhookUrl, webhookSecret, customerId, period } = payload;
  const DRY_RUN = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';

  try {
    const conn = await Datastore.open();

    // Get aggregation data
    const aggregation = await conn.getOne('aggregations', aggregationId);

    if (!aggregation) {
      console.error(`❌ [Webhook] Aggregation ${aggregationId} not found`);
      return res.end();
    }

    // Prepare webhook payload
    const webhookPayload = JSON.stringify({
      type: 'aggregation.completed',
      customerId,
      period,
      data: {
        periodStart: aggregation.periodStart,
        periodEnd: aggregation.periodEnd,
        periodKey: aggregation.periodKey,
        timestamp: aggregation.timestamp,
        events: aggregation.events,
        eventCounts: aggregation.eventCounts
      },
      created: Math.floor(Date.now() / 1000)
    });

    // Generate HMAC signature
    const { signature, timestamp } = generateSignature(webhookPayload, webhookSecret);

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestamp.toString(),
      'User-Agent': 'Codehooks-Metering/2.0',
      'Content-Length': Buffer.byteLength(webhookPayload)
    };

    // DRY RUN MODE - just log the payload without sending
    if (DRY_RUN) {
      console.log('🔵 [Webhook DRY RUN] Would send webhook:', {
        url: webhookUrl,
        aggregationId,
        customerId,
        period,
        headers,
        payload: JSON.parse(webhookPayload)
      });

      // Mark as delivered in dry run mode
      await conn.updateOne(
        'aggregations',
        aggregationId,
        {
          $set: {
            'webhookStatus.delivered': true,
            'webhookStatus.deliveredAt': new Date().toISOString(),
            'webhookStatus.attempts': (aggregation.webhookStatus?.attempts || 0) + 1,
            'webhookStatus.dryRun': true
          }
        }
      );

      console.log(`✅ [Webhook DRY RUN] Simulated delivery of aggregation ${aggregationId} to ${webhookUrl}`);
      return res.end();
    }

    // PRODUCTION MODE - actually send the webhook
    const response = await makeHttpRequest(webhookUrl, {
      method: 'POST',
      headers,
      timeout: 10000
    }, webhookPayload);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      await conn.updateOne(
        'aggregations',
        aggregationId,
        {
          $set: {
            'webhookStatus.delivered': true,
            'webhookStatus.deliveredAt': new Date().toISOString(),
            'webhookStatus.attempts': (aggregation.webhookStatus?.attempts || 0) + 1
          }
        }
      );

      console.log(`✅ [Webhook] Delivered aggregation ${aggregationId} to ${webhookUrl}`);
    } else {
      throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
    }

    res.end();
  } catch (error) {
    console.error('❌ [Webhook] Delivery failed:', error.message);

    try {
      const conn = await Datastore.open();
      const aggregation = await conn.getOne('aggregations', aggregationId);

      await conn.updateOne(
        'aggregations',
        aggregationId,
        {
          $set: {
            'webhookStatus.lastError': error.message,
            'webhookStatus.lastAttemptAt': new Date().toISOString()
          },
          $inc: { 'webhookStatus.attempts': 1 }
        }
      );
    } catch (updateError) {
      console.error('❌ [Webhook] Error updating failure status:', updateError);
    }

    res.status(500).end();
  }
});

// ============================================================================
// CRON JOB - BATCH AGGREGATION PROCESSOR
// ============================================================================

/**
 * Batch aggregation cron job
 * Runs every 15 minutes to aggregate completed periods
 */
app.job('*/15 * * * *', async (req, res) => {
  console.log('🔄 [Cron] Starting batch aggregation...');

  try {
    const conn = await Datastore.open();
    const now = new Date();
    const { periods, events: eventOps, webhooks } = systemConfig;

    let aggregationCount = 0;
    const processedCustomers = new Set();

    // Define lookback windows for each period type (in days)
    const lookbackDays = {
      hourly: 7,    // Look back 7 days for hourly aggregations
      daily: 30,    // Look back 30 days for daily aggregations
      weekly: 60,   // Look back 60 days for weekly aggregations
      monthly: 90,  // Look back 90 days for monthly aggregations
      yearly: 365   // Look back 1 year for yearly aggregations
    };

    // Process each configured period type
    for (const periodType of periods) {
      // Get the period field name for querying
      const periodField = periodType === 'hourly' ? 'hour' :
                          periodType === 'daily' ? 'day' :
                          periodType === 'weekly' ? 'week' :
                          periodType === 'monthly' ? 'month' : 'year';

      // Get events from the lookback window
      const lookbackMs = (lookbackDays[periodType] || 7) * 86400000;
      const lookbackDate = new Date(now.getTime() - lookbackMs);

      const recentEvents = await conn.getMany('events', {
        receivedAt: { $gte: lookbackDate.toISOString() }
      }).toArray();

      if (recentEvents.length === 0) {
        continue; // No events in lookback window
      }

      // Group events by period key
      const eventsByPeriod = {};
      for (const event of recentEvents) {
        const eventPeriodKey = event[periodField];
        if (!eventPeriodKey) continue;

        if (!eventsByPeriod[eventPeriodKey]) {
          eventsByPeriod[eventPeriodKey] = [];
        }
        eventsByPeriod[eventPeriodKey].push(event);
      }

      // Process each period that has events
      for (const [periodKey, eventsInPeriod] of Object.entries(eventsByPeriod)) {
        // Calculate period bounds to check if it's complete
        // We need to parse the periodKey to reconstruct the date
        let periodStart, periodEnd;
        try {
          // Reconstruct date from periodKey and calculate bounds
          const testDate = new Date(eventsInPeriod[0].receivedAt);
          const bounds = calculatePeriodBounds(periodType, testDate);
          if (bounds.periodKey !== periodKey) {
            // Find the correct date for this period key by iterating backwards
            let searchDate = new Date(now);
            let found = false;
            for (let i = 0; i < lookbackDays[periodType] * 24; i++) {
              const testBounds = calculatePeriodBounds(periodType, searchDate);
              if (testBounds.periodKey === periodKey) {
                periodStart = testBounds.periodStart;
                periodEnd = testBounds.periodEnd;
                found = true;
                break;
              }
              searchDate = new Date(searchDate.getTime() - 3600000); // Go back 1 hour
            }
            if (!found) {
              console.log(`⚠️  [Cron] Could not find period bounds for ${periodType} ${periodKey}`);
              continue;
            }
          } else {
            periodStart = bounds.periodStart;
            periodEnd = bounds.periodEnd;
          }
        } catch (error) {
          console.error(`❌ [Cron] Error calculating period bounds for ${periodType} ${periodKey}:`, error);
          continue;
        }

        // Check if this period has ended
        if (now < periodEnd) {
          continue; // Period not yet complete
        }

        // Get unique customers in this period
        const customersInPeriod = [...new Set(eventsInPeriod.map(e => e.customerId))];

        // Process each customer for this period
        for (const customerId of customersInPeriod) {
          // Check if we've already aggregated this period for this customer
          const existingAgg = await conn.getOne('aggregations', `${customerId}_${periodType}_${periodKey}`);
          if (existingAgg) {
            continue; // Already processed
          }

          // Aggregate each event type
          const aggregatedEvents = {};
          const eventCounts = {};

          for (const [eventType, config] of Object.entries(eventOps)) {
            try {
              const result = await performAggregation(
                conn,
                customerId,
                eventType,
                periodType,
                periodKey,
                config.op
              );

              if (result && result.value !== null && result.value !== undefined) {
                aggregatedEvents[eventType] = result.value;
                eventCounts[eventType] = result.count;
              }
            } catch (error) {
              console.error(`❌ [Cron] Error aggregating ${eventType} for ${customerId}:`, error);
            }
          }

          // Only create aggregation if we have data
          if (Object.keys(aggregatedEvents).length > 0) {
            const aggregation = {
              _id: `${customerId}_${periodType}_${periodKey}`,
              customerId,
              period: periodType,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
              periodKey,
              timestamp: now.toISOString(),
              events: aggregatedEvents,
              eventCounts,
              webhookStatus: {
                delivered: false,
                attempts: 0
              }
            };

            await conn.insertOne('aggregations', aggregation);
            aggregationCount++;
            processedCustomers.add(customerId); // Only count customers when aggregation is actually created

            console.log(`✅ [Cron] Created ${periodType} aggregation for ${customerId} (${periodKey})`);

            // Queue webhook deliveries
            if (webhooks && webhooks.length > 0) {
              for (const webhook of webhooks) {
                if (webhook.enabled) {
                  await conn.enqueue('deliver-aggregation-webhook', {
                    aggregationId: aggregation._id,
                    webhookUrl: webhook.url,
                    webhookSecret: webhook.secret,
                    customerId,
                    period: periodType
                  });
                  console.log(`📤 [Cron] Queued webhook to ${webhook.url}`);
                }
              }
            }
          }
        }
      }
    }

    if (processedCustomers.size === 0) {
      console.log('✅ [Cron] No completed periods with unaggregated events found');
    } else {
      console.log(`✅ [Cron] Completed batch aggregation: ${aggregationCount} aggregations created for ${processedCustomers.size} customers`);
    }

    res.end();
  } catch (error) {
    console.error('❌ [Cron] Fatal error:', error);
    res.end();
  }
});

// ============================================================================
// EXPORT
// ============================================================================

export default app.init();
