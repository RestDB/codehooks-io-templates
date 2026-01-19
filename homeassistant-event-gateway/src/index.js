/**
 * Home Assistant Event Gateway
 *
 * A Codehooks.io template for receiving Home Assistant events,
 * filtering noise, and forwarding notable events to Slack.
 *
 * Features:
 * - Webhook endpoint for Home Assistant events
 * - Event storage with normalized schema
 * - Rules-based noise filtering (deduplication, burst detection, time-of-day)
 * - Slack notifications for notable events
 * - Optional LLM-powered event explanations
 * - Daily digest endpoint
 */

import { app, Datastore } from 'codehooks-js';
import { verify } from 'webhook-verify';
import { evaluateEvent, isEventNotable } from './rules.js';
import { sendSlackNotification, formatSlackMessage } from './slack.js';
import { generateEventExplanation, isAIEnabled } from './ai.js';

// Collection name for storing events
const EVENTS_COLLECTION = 'ha_events';

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Validate shared secret from Home Assistant using webhook-verify
 * Events are rejected if the secret doesn't match
 */
function validateSecret(req) {
  const secret = process.env.HA_SHARED_SECRET;

  if (!secret) {
    console.warn('HA_SHARED_SECRET not configured - webhook is unprotected');
    return true; // Allow if not configured (development mode)
  }

  // Use webhook-verify for secure constant-time comparison
  return verify('homeassistant', req.rawBody, req.headers, secret);
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/ha/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'homeassistant-event-gateway',
    timestamp: new Date().toISOString(),
    features: {
      slack: !!process.env.SLACK_WEBHOOK_URL,
      ai: isAIEnabled()
    }
  });
});

/**
 * Main webhook endpoint for Home Assistant events
 * POST /ha/event
 *
 * Expected payload from Home Assistant:
 * {
 *   "entity_id": "binary_sensor.front_door",
 *   "event_type": "state_changed",
 *   "state": "on",
 *   "attributes": { ... },
 *   "timestamp": "2024-01-15T10:30:00Z"  // optional, will use server time if missing
 * }
 */
app.post('/ha/event', async (req, res) => {
  // Validate shared secret
  if (!validateSecret(req)) {
    console.warn('Invalid or missing X-HA-SECRET header');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = req.body;

  // Validate required fields
  if (!payload.entity_id) {
    res.status(400).json({ error: 'Missing required field: entity_id' });
    return;
  }

  try {
    const conn = await Datastore.open();
    const now = new Date();

    // Normalize the event
    const event = {
      entity_id: payload.entity_id,
      event_type: payload.event_type || 'state_changed',
      state: payload.state ?? null,
      attributes: payload.attributes || {},
      source: 'home_assistant',
      timestamp: payload.timestamp || now.toISOString(),
      received_at: now.toISOString(),
      // Add computed fields for querying
      hour_of_day: now.getUTCHours(),
      day_of_week: now.getUTCDay(),
      date_key: now.toISOString().split('T')[0]
    };

    // Evaluate against filtering rules
    const evaluation = await evaluateEvent(conn, event, EVENTS_COLLECTION);

    // Store the event with evaluation metadata
    const storedEvent = {
      ...event,
      _evaluation: {
        is_notable: evaluation.isNotable,
        reasons: evaluation.reasons,
        filters_applied: evaluation.filtersApplied
      }
    };

    const insertedEvent = await conn.insertOne(EVENTS_COLLECTION, storedEvent);

    // If notable, send Slack notification
    if (evaluation.isNotable && process.env.SLACK_WEBHOOK_URL) {
      // Generate AI explanation if enabled
      let aiExplanation = null;
      if (isAIEnabled()) {
        try {
          aiExplanation = await generateEventExplanation(event, evaluation.reasons);
        } catch (aiError) {
          console.error('AI explanation failed:', aiError.message);
          // Continue without AI explanation
        }
      }

      const slackMessage = formatSlackMessage(event, evaluation.reasons, aiExplanation);

      // Send asynchronously - don't block the response
      sendSlackNotification(slackMessage).catch(err => {
        console.error('Slack notification failed:', err.message);
      });
    }

    res.status(201).json({
      id: insertedEvent._id,
      notable: evaluation.isNotable,
      reasons: evaluation.reasons
    });

  } catch (error) {
    console.error('Error processing event:', error);
    res.status(500).json({ error: 'Failed to process event' });
  }
});

/**
 * Daily digest endpoint
 * GET /ha/digest
 *
 * Returns a summary of events from the last 24 hours
 */
app.get('/ha/digest', async (req, res) => {
  try {
    const conn = await Datastore.open();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get all events from last 24 hours
    const events = await conn.getMany(EVENTS_COLLECTION, {
      received_at: { $gte: twentyFourHoursAgo.toISOString() }
    }).toArray();

    // Calculate statistics
    const totalEvents = events.length;
    const notableEvents = events.filter(e => e._evaluation?.is_notable).length;

    // Count by entity_id
    const entityCounts = {};
    for (const event of events) {
      entityCounts[event.entity_id] = (entityCounts[event.entity_id] || 0) + 1;
    }

    // Sort entities by frequency
    const sortedEntities = Object.entries(entityCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10

    // Count by event_type
    const eventTypeCounts = {};
    for (const event of events) {
      eventTypeCounts[event.event_type] = (eventTypeCounts[event.event_type] || 0) + 1;
    }

    // Count notable reasons
    const reasonCounts = {};
    for (const event of events) {
      if (event._evaluation?.reasons) {
        for (const reason of event._evaluation.reasons) {
          reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        }
      }
    }

    res.json({
      period: {
        start: twentyFourHoursAgo.toISOString(),
        end: now.toISOString()
      },
      summary: {
        total_events: totalEvents,
        notable_events: notableEvents,
        notable_percentage: totalEvents > 0
          ? Math.round((notableEvents / totalEvents) * 100)
          : 0
      },
      top_entities: sortedEntities.map(([entity_id, count]) => ({
        entity_id,
        count
      })),
      event_types: eventTypeCounts,
      notable_reasons: reasonCounts,
      generated_at: now.toISOString()
    });

  } catch (error) {
    console.error('Error generating digest:', error);
    res.status(500).json({ error: 'Failed to generate digest' });
  }
});

/**
 * Query events endpoint
 * GET /ha/events
 *
 * Query parameters:
 * - entity_id: filter by entity
 * - event_type: filter by event type
 * - notable: filter by notable status (true/false)
 * - from: start timestamp
 * - to: end timestamp
 * - limit: max results (default 100)
 */
app.get('/ha/events', async (req, res) => {
  const { entity_id, event_type, notable, from, to, limit = 100 } = req.query;

  const query = {};

  if (entity_id) query.entity_id = entity_id;
  if (event_type) query.event_type = event_type;
  if (notable !== undefined) {
    query['_evaluation.is_notable'] = notable === 'true';
  }
  if (from || to) {
    query.received_at = {};
    if (from) query.received_at.$gte = from;
    if (to) query.received_at.$lte = to;
  }

  try {
    const conn = await Datastore.open();
    const events = await conn.getMany(EVENTS_COLLECTION, query, {
      sort: { received_at: -1 },
      limit: Math.min(parseInt(limit), 1000)
    }).toArray();

    res.json({
      count: events.length,
      events
    });

  } catch (error) {
    console.error('Error querying events:', error);
    res.status(500).json({ error: 'Failed to query events' });
  }
});

// ============================================================================
// AUTH CONFIGURATION
// ============================================================================

/**
 * Allow public access to the HA webhook endpoint
 * Authentication is handled via X-HA-SECRET header
 */
app.auth('/ha/*', (req, res, next) => {
  next(); // Allow public access
});

// ============================================================================
// EXPORT
// ============================================================================

export default app.init();
