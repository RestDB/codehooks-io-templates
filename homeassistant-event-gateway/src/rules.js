/**
 * Rules-based noise filtering for Home Assistant events
 *
 * This module implements heuristics to determine if an event is "notable"
 * and should trigger a notification. No AI is required for these rules.
 *
 * Filters:
 * 1. Deduplication - ignore identical events within a time window
 * 2. Burst detection - flag rapid repeated triggers from same entity
 * 3. Time-of-day - different sensitivity for night vs day
 * 4. Allowlist/Denylist - entity-based filtering via environment variables
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Parse comma-separated list from environment variable
 */
function parseEntityList(envVar) {
  const value = process.env[envVar];
  if (!value) return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Get configuration from environment with defaults
 */
function getConfig() {
  return {
    // Deduplication window in seconds (default: 60 seconds)
    dedupeWindowSec: parseInt(process.env.DEDUPE_WINDOW_SEC || '60'),

    // Burst detection: N events in M minutes triggers a burst flag
    burstThreshold: parseInt(process.env.BURST_THRESHOLD || '5'),
    burstWindowMin: parseInt(process.env.BURST_WINDOW_MIN || '5'),

    // Night hours (24h format, UTC)
    nightStartHour: parseInt(process.env.NIGHT_START_HOUR || '22'),
    nightEndHour: parseInt(process.env.NIGHT_END_HOUR || '6'),

    // Entity lists
    allowlist: parseEntityList('HA_ENTITY_ALLOWLIST'),
    denylist: parseEntityList('HA_ENTITY_DENYLIST'),

    // Notable event types (always notify for these)
    notableEventTypes: parseEntityList('HA_NOTABLE_EVENT_TYPES') || [
      'alarm_triggered',
      'device_offline',
      'battery_low'
    ],

    // Notable state changes (state values that are always notable)
    notableStates: parseEntityList('HA_NOTABLE_STATES') || [
      'alarm',
      'problem',
      'unavailable'
    ]
  };
}

// ============================================================================
// FILTER IMPLEMENTATIONS
// ============================================================================

/**
 * Check if entity is in denylist
 * Supports wildcards: "sensor.temperature_*" matches "sensor.temperature_kitchen"
 */
function isEntityDenied(entityId, denylist) {
  for (const pattern of denylist) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(entityId)) return true;
    } else if (entityId === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Check if entity is in allowlist
 * If allowlist is empty, all entities are allowed
 * Supports wildcards: "binary_sensor.*" matches all binary sensors
 */
function isEntityAllowed(entityId, allowlist) {
  if (allowlist.length === 0) return true; // No allowlist = allow all

  for (const pattern of allowlist) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(entityId)) return true;
    } else if (entityId === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Check for duplicate events within the deduplication window
 * Returns true if this is a duplicate (should be filtered)
 */
async function isDuplicateEvent(conn, event, collection, windowSec) {
  const windowStart = new Date(Date.now() - windowSec * 1000);

  const recentEvents = await conn.getMany(collection, {
    entity_id: event.entity_id,
    state: event.state,
    received_at: { $gte: windowStart.toISOString() }
  }, { limit: 1 }).toArray();

  return recentEvents.length > 0;
}

/**
 * Detect burst patterns - same entity firing rapidly
 * Returns burst info if detected
 */
async function detectBurst(conn, event, collection, threshold, windowMin) {
  const windowStart = new Date(Date.now() - windowMin * 60 * 1000);

  const recentEvents = await conn.getMany(collection, {
    entity_id: event.entity_id,
    received_at: { $gte: windowStart.toISOString() }
  }).toArray();

  const count = recentEvents.length;

  if (count >= threshold) {
    return {
      detected: true,
      count,
      windowMin
    };
  }

  return { detected: false };
}

/**
 * Determine if current time is during night hours
 */
function isNightTime(hourOfDay, nightStart, nightEnd) {
  // Handle overnight spans (e.g., 22:00 to 06:00)
  if (nightStart > nightEnd) {
    return hourOfDay >= nightStart || hourOfDay < nightEnd;
  }
  return hourOfDay >= nightStart && hourOfDay < nightEnd;
}

/**
 * Check if event type is inherently notable
 */
function isNotableEventType(eventType, notableTypes) {
  return notableTypes.includes(eventType);
}

/**
 * Check if state is inherently notable
 */
function isNotableState(state, notableStates) {
  if (!state) return false;
  const stateLower = String(state).toLowerCase();
  return notableStates.some(s => stateLower.includes(s.toLowerCase()));
}

// ============================================================================
// MAIN EVALUATION FUNCTION
// ============================================================================

/**
 * Evaluate an event against all filtering rules
 *
 * @param {Object} conn - Database connection
 * @param {Object} event - The normalized event
 * @param {string} collection - Collection name
 * @returns {Object} Evaluation result with isNotable flag and reasons
 */
export async function evaluateEvent(conn, event, collection) {
  const config = getConfig();
  const reasons = [];
  const filtersApplied = [];

  // Track what filters we're applying
  filtersApplied.push('allowlist_denylist');
  filtersApplied.push('deduplication');
  filtersApplied.push('burst_detection');
  filtersApplied.push('time_of_day');
  filtersApplied.push('notable_types');

  // 1. Check denylist first (quick exit)
  if (isEntityDenied(event.entity_id, config.denylist)) {
    return {
      isNotable: false,
      reasons: ['Entity is in denylist'],
      filtersApplied,
      filtered: true
    };
  }

  // 2. Check allowlist
  if (!isEntityAllowed(event.entity_id, config.allowlist)) {
    return {
      isNotable: false,
      reasons: ['Entity is not in allowlist'],
      filtersApplied,
      filtered: true
    };
  }

  // 3. Check for duplicates
  const isDupe = await isDuplicateEvent(conn, event, collection, config.dedupeWindowSec);
  if (isDupe) {
    return {
      isNotable: false,
      reasons: [`Duplicate event within ${config.dedupeWindowSec}s window`],
      filtersApplied,
      filtered: true
    };
  }

  // 4. Check for burst patterns
  const burst = await detectBurst(
    conn, event, collection,
    config.burstThreshold, config.burstWindowMin
  );
  if (burst.detected) {
    reasons.push(`Burst detected: ${burst.count} events in ${burst.windowMin} minutes`);
  }

  // 5. Check if event type is inherently notable
  if (isNotableEventType(event.event_type, config.notableEventTypes)) {
    reasons.push(`Notable event type: ${event.event_type}`);
  }

  // 6. Check if state is inherently notable
  if (isNotableState(event.state, config.notableStates)) {
    reasons.push(`Notable state: ${event.state}`);
  }

  // 7. Time-of-day context
  const isNight = isNightTime(
    event.hour_of_day,
    config.nightStartHour,
    config.nightEndHour
  );
  if (isNight) {
    // Night events from motion/door sensors are more notable
    if (event.entity_id.includes('motion') || event.entity_id.includes('door')) {
      if (event.state === 'on' || event.state === 'open') {
        reasons.push('Night-time activity detected');
      }
    }
  }

  // Determine if notable
  // An event is notable if it has at least one reason
  const isNotable = reasons.length > 0;

  return {
    isNotable,
    reasons,
    filtersApplied,
    filtered: false,
    context: {
      isNightTime: isNight,
      burstDetected: burst.detected
    }
  };
}

/**
 * Simple helper to check if an event is notable
 * (For use in other modules)
 */
export function isEventNotable(evaluation) {
  return evaluation?.isNotable === true;
}
