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
  const MAX_BATCH_SIZE = 1000;

  try {
    // Validate request body exists
    if (req.body === null || req.body === undefined) {
      console.warn('⚠️ [API] /usagebatch called with null/undefined body');
      return res.status(400).json({ error: 'Request body is required' });
    }

    const events = req.body;

    // Validate input is an array
    if (!Array.isArray(events)) {
      console.warn('⚠️ [API] /usagebatch called with non-array body:', typeof events);
      return res.status(400).json({ error: 'Request body must be an array of events' });
    }

    if (events.length === 0) {
      return res.status(400).json({ error: 'Events array cannot be empty' });
    }

    // Enforce batch size limit
    if (events.length > MAX_BATCH_SIZE) {
      console.warn(`⚠️ [API] /usagebatch batch size exceeded: ${events.length} > ${MAX_BATCH_SIZE}`);
      return res.status(413).json({
        error: `Batch size exceeds maximum limit of ${MAX_BATCH_SIZE} events`,
        received: events.length,
        maxAllowed: MAX_BATCH_SIZE
      });
    }

    // Get valid event types safely
    const validEventTypes = systemConfig?.events ? Object.keys(systemConfig.events) : [];
    if (validEventTypes.length === 0) {
      console.error('❌ [API] /usagebatch: No event types configured in systemconfig.json');
      return res.status(503).json({ error: 'Service misconfigured: no event types available' });
    }

    // Validate each event and collect errors
    const validationErrors = [];
    const validEvents = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const errors = [];

      // Check if event is a valid object
      if (event === null || event === undefined || typeof event !== 'object') {
        validationErrors.push({ index: i, errors: ['Event must be an object'] });
        continue;
      }

      if (!event.eventType) {
        errors.push('eventType is required');
      } else if (typeof event.eventType !== 'string') {
        errors.push('eventType must be a string');
      } else if (!systemConfig.events[event.eventType]) {
        errors.push(`Invalid event type: ${event.eventType}. Must be one of: ${validEventTypes.join(', ')}`);
      }

      if (!event.customerId) {
        errors.push('customerId is required');
      } else if (typeof event.customerId !== 'string') {
        errors.push('customerId must be a string');
      }

      if (event.value === null || event.value === undefined) {
        errors.push('value is required');
      } else if (typeof event.value !== 'number' || !Number.isFinite(event.value)) {
        errors.push('value must be a finite number');
      }

      // Validate metadata if provided
      if (event.metadata !== undefined && (typeof event.metadata !== 'object' || event.metadata === null || Array.isArray(event.metadata))) {
        errors.push('metadata must be an object if provided');
      }

      if (errors.length > 0) {
        validationErrors.push({ index: i, errors });
      } else {
        validEvents.push(event);
      }
    }

    // If there are validation errors, return them
    if (validationErrors.length > 0) {
      console.warn(`⚠️ [API] /usagebatch validation failed: ${validationErrors.length}/${events.length} events invalid`);
      return res.status(422).json({
        error: 'Validation failed for some events',
        validationErrors,
        validCount: validEvents.length,
        invalidCount: validationErrors.length
      });
    }

    const conn = await Datastore.open();
    const timestamp = new Date();
    const timePeriods = calculateTimePeriods(timestamp);

    // Store all events with individual error tracking
    const results = await Promise.allSettled(
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

    // Check for any failed inserts
    const failed = results.filter(r => r.status === 'rejected');
    const succeeded = results.filter(r => r.status === 'fulfilled');

    if (failed.length > 0) {
      console.error(`❌ [API] /usagebatch partial failure: ${failed.length}/${validEvents.length} inserts failed`);
      failed.forEach((f, i) => console.error(`  - Insert ${i} failed:`, f.reason?.message || f.reason));

      if (succeeded.length === 0) {
        return res.status(500).json({
          error: 'Failed to store all events',
          failedCount: failed.length
        });
      }

      // Partial success
      return res.status(207).json({
        message: 'Events partially captured',
        successCount: succeeded.length,
        failedCount: failed.length
      });
    }

    console.log(`✅ [API] /usagebatch: ${succeeded.length} events captured`);
    res.status(201).json({
      message: 'Events captured',
      count: succeeded.length
    });
  } catch (error) {
    console.error('❌ [API] /usagebatch unexpected error:', error.message, error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Capture usage event
 * POST /usage/:eventType
 * Body: { customerId, value, metadata? }
 */
app.post('/usage/:eventType', async (req, res) => {
  try {
    const { eventType } = req.params;

    // Validate eventType parameter
    if (!eventType || typeof eventType !== 'string') {
      console.warn('⚠️ [API] /usage/:eventType called with invalid eventType param');
      return res.status(400).json({ error: 'eventType parameter is required' });
    }

    // Get valid event types safely
    const validEventTypes = systemConfig?.events ? Object.keys(systemConfig.events) : [];
    if (validEventTypes.length === 0) {
      console.error('❌ [API] /usage/:eventType: No event types configured in systemconfig.json');
      return res.status(503).json({ error: 'Service misconfigured: no event types available' });
    }

    // Validate event type exists in config
    if (!systemConfig.events[eventType]) {
      console.warn(`⚠️ [API] /usage/${eventType}: Invalid event type`);
      return res.status(400).json({
        error: `Invalid event type: ${eventType}. Must be one of: ${validEventTypes.join(', ')}`
      });
    }

    // Validate request body exists
    if (req.body === null || req.body === undefined || typeof req.body !== 'object') {
      console.warn(`⚠️ [API] /usage/${eventType}: Missing or invalid request body`);
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const { customerId, value, metadata } = req.body;

    // Collect all validation errors
    const errors = [];

    if (!customerId) {
      errors.push('customerId is required');
    } else if (typeof customerId !== 'string') {
      errors.push('customerId must be a string');
    }

    if (value === null || value === undefined) {
      errors.push('value is required');
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push('value must be a finite number');
    }

    // Validate metadata if provided
    if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
      errors.push('metadata must be an object if provided');
    }

    if (errors.length > 0) {
      console.warn(`⚠️ [API] /usage/${eventType}: Validation failed - ${errors.join(', ')}`);
      return res.status(422).json({
        error: 'Validation failed',
        details: errors
      });
    }

    const conn = await Datastore.open();
    const timestamp = new Date();
    const timePeriods = calculateTimePeriods(timestamp);

    // Store event with time period fields
    await conn.insertOne('events', {
      eventType,
      customerId,
      value,
      metadata: metadata || {},
      receivedAt: timestamp.toISOString(),
      ...timePeriods
    });

    console.log(`✅ [API] /usage/${eventType}: Event captured for ${customerId}`);
    res.status(201).json({
      message: 'Event captured',
      eventType,
      customerId
    });
  } catch (error) {
    const eventType = req.params?.eventType || 'unknown';
    console.error(`❌ [API] /usage/${eventType} unexpected error:`, error.message, error.stack);
    res.status(500).json({ error: 'Internal server error' });
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
 * Trigger aggregation manually (queue-based with enqueueFromQuery)
 * POST /aggregations/trigger
 *
 * Uses enqueueFromQuery for ultra-fast bulk enqueueing directly on the server.
 * 1. Creates pending job records in 'pending_agg_jobs' collection (with upsert for dedup)
 * 2. Uses enqueueFromQuery to bulk-enqueue all pending jobs in one call
 */
app.post('/aggregations/trigger', async (req, res) => {
  console.log('🔄 [Trigger] Creating aggregation jobs...');

  try {
    const conn = await Datastore.open();
    const now = new Date();
    const { periods } = systemConfig;

    if (!periods || periods.length === 0) {
      return res.status(503).json({ error: 'No periods configured in systemconfig.json' });
    }

    // Stream through all events to collect unique customers (memory efficient)
    const uniqueCustomers = new Set();
    let eventCount = 0;

    await conn.getMany('events', {}, {
      hints: { $fields: { customerId: 1 } }
    }).forEach(event => {
      if (event.customerId) uniqueCustomers.add(event.customerId);
      eventCount++;
    });

    const customerArray = Array.from(uniqueCustomers);
    console.log(`📊 [Trigger] Found ${customerArray.length} unique customers from ${eventCount} events`);

    if (customerArray.length === 0) {
      return res.json({
        message: 'No events to aggregate',
        jobsQueued: 0
      });
    }

    let jobsCreated = 0;
    let jobsSkipped = 0;

    // Create pending job records for each customer + period combination
    // Using upsert to prevent duplicates
    for (const customerId of customerArray) {
      for (const periodType of periods) {
        const { periodStart, periodEnd, periodKey } = calculatePeriodBounds(periodType, now);
        const jobId = `${customerId}_${periodType}_${periodKey}`;

        // Use upsert to create or skip existing pending jobs
        const result = await conn.updateOne(
          'pending_agg_jobs',
          jobId,
          {
            $set: {
              customerId,
              periodType,
              periodKey,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
              status: 'pending',
              createdAt: now.toISOString(),
              source: 'trigger'
            }
          },
          { upsert: true }
        );

        if (result?.upsertedId || result?.upserted) {
          jobsCreated++;
        } else {
          jobsSkipped++;
        }
      }
    }

    console.log(`📝 [Trigger] Created ${jobsCreated} new, updated ${jobsSkipped} existing job records`);

    // Count pending jobs before enqueueing
    const pendingJobs = await conn.getMany('pending_agg_jobs', { status: 'pending' }).toArray();
    const pendingCount = pendingJobs.length;

    if (pendingCount === 0) {
      console.log(`✅ [Trigger] No pending jobs to enqueue`);
    } else {
      // Bulk enqueue all pending jobs using enqueueFromQuery (server-side, ultra fast)
      await conn.enqueueFromQuery(
        'pending_agg_jobs',
        { status: 'pending' },
        'process-aggregation-job'
      );

      // Mark jobs as queued to prevent re-queuing
      await conn.updateMany(
        'pending_agg_jobs',
        { status: 'pending' },
        { $set: { status: 'queued', queuedAt: now.toISOString() } }
      );

      console.log(`✅ [Trigger] Bulk enqueued ${pendingCount} jobs for ${customerArray.length} customers`);
    }

    res.status(202).json({
      message: 'Aggregation jobs queued for processing',
      jobsCreated,
      jobsUpdated: jobsSkipped,
      jobsQueued: pendingCount,
      customersFound: customerArray.length,
      periodsConfigured: periods.length,
      eventsScanned: eventCount
    });
  } catch (error) {
    console.error('❌ [Trigger] Error queueing jobs:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to queue aggregation jobs' });
  }
});

/**
 * Worker: Process individual aggregation job
 * Handles aggregation for a single customer + period combination
 * Payload comes from enqueueFromQuery (full document from pending_agg_jobs)
 * Uses distributed locking and upsert for idempotency
 */
app.worker('process-aggregation-job', async (req, res) => {
  const { payload } = req.body;
  const { _id: jobId, customerId, periodType, periodKey, periodStart, periodEnd } = payload;

  const aggregationId = `${customerId}_${periodType}_${periodKey}`;
  const lockKey = `agg_lock_${aggregationId}`;

  try {
    const conn = await Datastore.open();
    const now = new Date();
    const { events: eventOps, webhooks } = systemConfig;

    // Try to acquire a processing lock (prevents concurrent processing)
    const existingLock = await conn.get(lockKey, { keyspace: 'aggregation-locks' });
    if (existingLock) {
      console.log(`⏭️ [Worker] Skipping ${periodType} for ${customerId} (${periodKey}) - already being processed`);
      return res.end();
    }

    // Acquire lock with 2 minute TTL
    await conn.set(lockKey, now.toISOString(), {
      keyspace: 'aggregation-locks',
      ttl: 2 * 60 * 1000
    });

    if (!eventOps || Object.keys(eventOps).length === 0) {
      console.error('❌ [Worker] No event types configured');
      await conn.del(lockKey, { keyspace: 'aggregation-locks' });
      return res.end();
    }

    // Check if period is complete
    const periodEndDate = new Date(periodEnd);
    const isPeriodComplete = now >= periodEndDate;

    // For completed periods, check if already aggregated to avoid unnecessary work
    if (isPeriodComplete) {
      const existingAgg = await conn.findOneOrNull('aggregations', aggregationId);
      if (existingAgg) {
        console.log(`⏭️ [Worker] Skipping ${periodType} for ${customerId} (${periodKey}) - already finalized`);
        await conn.del(lockKey, { keyspace: 'aggregation-locks' });
        if (jobId) await conn.removeOne('pending_agg_jobs', jobId);
        return res.end();
      }
    }

    console.log(`🔄 [Worker] Processing ${periodType} aggregation for ${customerId} (${periodKey})`);

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
        console.error(`❌ [Worker] Error aggregating ${eventType} for ${customerId}:`, error.message);
      }
    }

    // Only create/update aggregation if we have data
    if (Object.keys(aggregatedEvents).length === 0) {
      console.log(`⏭️ [Worker] No data for ${periodType} aggregation of ${customerId} (${periodKey})`);
      await conn.del(lockKey, { keyspace: 'aggregation-locks' });
      if (jobId) await conn.removeOne('pending_agg_jobs', jobId);
      return res.end();
    }

    // Check if aggregation already exists (to determine if this is create vs update)
    const existingAgg = await conn.findOneOrNull('aggregations', aggregationId);
    const isNewAggregation = !existingAgg;

    // Use explicit insert or update (upsert with query doesn't preserve _id in Codehooks)
    if (isNewAggregation) {
      // Insert new aggregation with our deterministic ID
      await conn.insertOne('aggregations', {
        _id: aggregationId,
        customerId,
        period: periodType,
        periodStart,
        periodEnd,
        periodKey,
        timestamp: now.toISOString(),
        events: aggregatedEvents,
        eventCounts,
        webhookStatus: { delivered: false, attempts: 0 }
      });
    } else {
      // Update existing aggregation
      await conn.updateOne(
        'aggregations',
        aggregationId,
        {
          $set: {
            timestamp: now.toISOString(),
            events: aggregatedEvents,
            eventCounts
          }
        }
      );
    }

    if (isNewAggregation) {
      console.log(`✅ [Worker] Created ${periodType} aggregation for ${customerId} (${periodKey})`);

      // Queue webhook deliveries ONLY for completed periods and new aggregations
      if (isPeriodComplete && webhooks && webhooks.length > 0) {
        for (const webhook of webhooks) {
          if (webhook.enabled) {
            await conn.enqueue('deliver-aggregation-webhook', {
              aggregationId,
              webhookUrl: webhook.url,
              webhookSecret: webhook.secret,
              customerId,
              period: periodType
            });
            console.log(`📤 [Worker] Queued webhook for ${customerId} ${periodType}`);
          }
        }
      }
    } else {
      console.log(`🔄 [Worker] Updated ${periodType} aggregation for ${customerId} (${periodKey})`);
    }

    // Release lock and clean up pending job record
    await conn.del(lockKey, { keyspace: 'aggregation-locks' });
    if (jobId) {
      await conn.removeOne('pending_agg_jobs', jobId);
    }

    res.end();
  } catch (error) {
    console.error(`❌ [Worker] Fatal error for ${customerId} ${periodType}:`, error.message, error.stack);
    // Try to release lock on error
    try {
      const conn = await Datastore.open();
      await conn.del(lockKey, { keyspace: 'aggregation-locks' });
    } catch (cleanupError) {
      console.error('❌ [Worker] Failed to release lock:', cleanupError.message);
    }
    res.status(500).end();
  }
}, { timeout: 30000, workers: 1 });

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
// CRON JOB - COMPLETED PERIOD AGGREGATION PROCESSOR
// ============================================================================

/**
 * Calculate the PREVIOUS (completed) period boundaries
 * @param {string} periodType - hourly, daily, weekly, monthly
 * @param {Date} now - Current date/time
 * @returns {{periodStart: Date, periodEnd: Date, periodKey: string}}
 */
function calculateCompletedPeriodBounds(periodType, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  let periodStart, periodEnd, periodKey;

  switch (periodType) {
    case 'hourly':
      // Previous hour
      periodStart = new Date(Date.UTC(year, month, date, hour - 1, 0, 0, 0));
      periodEnd = new Date(Date.UTC(year, month, date, hour - 1, 59, 59, 999));
      periodKey = `${periodStart.getUTCFullYear()}${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}${String(periodStart.getUTCDate()).padStart(2, '0')}${String(periodStart.getUTCHours()).padStart(2, '0')}`;
      break;

    case 'daily':
      // Yesterday
      periodStart = new Date(Date.UTC(year, month, date - 1, 0, 0, 0, 0));
      periodEnd = new Date(Date.UTC(year, month, date - 1, 23, 59, 59, 999));
      periodKey = `${periodStart.getUTCFullYear()}${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}${String(periodStart.getUTCDate()).padStart(2, '0')}`;
      break;

    case 'weekly':
      // Last week (Monday to Sunday)
      const lastMonday = new Date(Date.UTC(year, month, date - day - 6, 0, 0, 0, 0));
      periodStart = lastMonday;
      periodEnd = new Date(lastMonday.getTime() + 7 * 86400000 - 1);
      periodKey = getISOWeek(periodStart);
      break;

    case 'monthly':
      // Last month
      periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      periodKey = `${periodStart.getUTCFullYear()}${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
      break;

    default:
      throw new Error(`Invalid period type: ${periodType}`);
  }

  return { periodStart, periodEnd, periodKey };
}

/**
 * Batch aggregation cron job
 * Runs every 15 minutes to check for and process COMPLETED periods only
 * - Daily: aggregates yesterday's data
 * - Weekly: aggregates last week's data
 * - Monthly: aggregates last month's data
 */
app.job('*/15 * * * *', async (req, res) => {
  console.log('🔄 [Cron] Checking for completed periods to aggregate...');

  try {
    const conn = await Datastore.open();
    const now = new Date();
    const { periods } = systemConfig;

    if (!periods || periods.length === 0) {
      console.log('⚠️ [Cron] No periods configured');
      return res.end();
    }

    // Stream through all events to collect unique customers
    const uniqueCustomers = new Set();
    let eventCount = 0;

    await conn.getMany('events', {}, {
      hints: { $fields: { customerId: 1 } }
    }).forEach(event => {
      if (event.customerId) uniqueCustomers.add(event.customerId);
      eventCount++;
    });

    const customerArray = Array.from(uniqueCustomers);

    if (customerArray.length === 0) {
      console.log('✅ [Cron] No customers to process');
      return res.end();
    }

    let totalJobsCreated = 0;
    let totalJobsSkipped = 0;

    // Process each period type - only for COMPLETED periods
    for (const periodType of periods) {
      const { periodStart, periodEnd, periodKey } = calculateCompletedPeriodBounds(periodType, now);

      // Check if we have any events in this completed period
      const periodFieldMap = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month' };
      const periodField = periodFieldMap[periodType];
      const eventsInPeriod = await conn.getMany('events', { [periodField]: periodKey }, { limit: 1 }).toArray();

      if (eventsInPeriod.length === 0) {
        console.log(`⏭️ [Cron] No events found for completed ${periodType} period ${periodKey}, skipping`);
        continue;
      }

      // Create pending job records for each customer for this completed period
      for (const customerId of customerArray) {
        const jobId = `${customerId}_${periodType}_${periodKey}`;

        // Check if aggregation already exists and is finalized
        const existingAgg = await conn.findOneOrNull('aggregations', jobId);
        if (existingAgg) {
          // Already aggregated, skip
          continue;
        }

        const result = await conn.updateOne(
          'pending_agg_jobs',
          jobId,
          {
            $set: {
              customerId,
              periodType,
              periodKey,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
              status: 'pending',
              createdAt: now.toISOString(),
              source: 'cron'
            }
          },
          { upsert: true }
        );

        if (result?.upsertedId || result?.upserted) {
          totalJobsCreated++;
        } else {
          totalJobsSkipped++;
        }
      }
    }

    // Count and enqueue all pending jobs
    const pendingJobs = await conn.getMany('pending_agg_jobs', { status: 'pending' }).toArray();
    const pendingCount = pendingJobs.length;

    if (pendingCount === 0) {
      console.log(`✅ [Cron] No pending jobs to enqueue (all completed periods already aggregated)`);
    } else {
      await conn.enqueueFromQuery(
        'pending_agg_jobs',
        { status: 'pending' },
        'process-aggregation-job'
      );

      await conn.updateMany(
        'pending_agg_jobs',
        { status: 'pending' },
        { $set: { status: 'queued', queuedAt: now.toISOString() } }
      );

      console.log(`✅ [Cron] Queued ${pendingCount} jobs for completed periods (${totalJobsCreated} new, ${totalJobsSkipped} updated)`);
    }

    res.end();
  } catch (error) {
    console.error('❌ [Cron] Fatal error:', error.message, error.stack);
    res.end();
  }
});


// ============================================================================
// EXPORT
// ============================================================================

// Note: events collection is capped to 10000 via CLI: coho cap events 10000
export default app.init();
