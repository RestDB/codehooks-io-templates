/**
 * Slack notification module for Home Assistant events
 *
 * Handles formatting events into Slack messages and sending
 * them via Incoming Webhook.
 *
 * Slack integration is optional - if SLACK_WEBHOOK_URL is not set,
 * notifications are silently skipped.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Check if Slack is configured
 */
export function isSlackEnabled() {
  return !!process.env.SLACK_WEBHOOK_URL;
}

// ============================================================================
// MESSAGE FORMATTING
// ============================================================================

/**
 * Get emoji for entity type
 */
function getEntityEmoji(entityId) {
  const domain = entityId.split('.')[0];

  const emojiMap = {
    'binary_sensor': ':radio_button:',
    'sensor': ':bar_chart:',
    'light': ':bulb:',
    'switch': ':electric_plug:',
    'lock': ':lock:',
    'door': ':door:',
    'motion': ':runner:',
    'temperature': ':thermometer:',
    'humidity': ':droplet:',
    'camera': ':movie_camera:',
    'alarm': ':rotating_light:',
    'climate': ':snowflake:',
    'cover': ':roller_coaster:',
    'fan': ':dash:',
    'vacuum': ':robot_face:',
    'media_player': ':tv:'
  };

  // Check domain first
  if (emojiMap[domain]) return emojiMap[domain];

  // Check if entity_id contains keywords
  for (const [keyword, emoji] of Object.entries(emojiMap)) {
    if (entityId.includes(keyword)) return emoji;
  }

  return ':house:'; // Default home emoji
}

/**
 * Format entity ID for display
 * "binary_sensor.front_door_contact" -> "Front Door Contact"
 */
function formatEntityName(entityId) {
  // Remove domain prefix
  const name = entityId.split('.').slice(1).join('.');

  // Convert snake_case to Title Case
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format state value for display
 */
function formatState(state) {
  if (state === null || state === undefined) return 'unknown';
  if (typeof state === 'boolean') return state ? 'On' : 'Off';
  if (state === 'on') return 'On';
  if (state === 'off') return 'Off';
  if (state === 'open') return 'Open';
  if (state === 'closed') return 'Closed';
  if (state === 'locked') return 'Locked';
  if (state === 'unlocked') return 'Unlocked';
  return String(state);
}

/**
 * Build Slack Block Kit message
 *
 * @param {Object} event - The Home Assistant event
 * @param {Array} reasons - Why this event is notable
 * @param {string|null} aiExplanation - Optional AI-generated explanation
 * @returns {Object} Slack message payload
 */
export function formatSlackMessage(event, reasons, aiExplanation = null) {
  const emoji = getEntityEmoji(event.entity_id);
  const entityName = formatEntityName(event.entity_id);
  const time = formatTime(event.timestamp);
  const state = formatState(event.state);

  // Build the blocks
  const blocks = [];

  // Header with emoji and entity name
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${emoji} ${entityName}`,
      emoji: true
    }
  });

  // State and time section
  blocks.push({
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*State:*\n${state}`
      },
      {
        type: 'mrkdwn',
        text: `*Time:*\n${time}`
      }
    ]
  });

  // Entity ID in smaller text
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Entity: \`${event.entity_id}\` | Type: \`${event.event_type}\``
      }
    ]
  });

  // Reasons why this is notable
  if (reasons && reasons.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Why notable:*\n${reasons.map(r => `• ${r}`).join('\n')}`
      }
    });
  }

  // AI explanation (if available)
  if (aiExplanation) {
    blocks.push({
      type: 'divider'
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:robot_face: *AI Analysis:*\n${aiExplanation}`
      }
    });
  }

  // Footer with source
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Source: Home Assistant | ${new Date().toISOString().split('T')[0]}`
      }
    ]
  });

  return {
    blocks,
    // Fallback text for notifications
    text: `${emoji} ${entityName}: ${state}`
  };
}

/**
 * Format a simple text-only message (fallback)
 */
export function formatSimpleMessage(event, reasons) {
  const entityName = formatEntityName(event.entity_id);
  const state = formatState(event.state);
  const time = formatTime(event.timestamp);

  let message = `*${entityName}* is now *${state}* (${time})`;

  if (reasons && reasons.length > 0) {
    message += `\n_Notable because: ${reasons.join(', ')}_`;
  }

  return { text: message };
}

// ============================================================================
// SLACK API
// ============================================================================

/**
 * Send a message to Slack via Incoming Webhook
 *
 * @param {Object} message - Slack message payload
 * @returns {Promise<void>}
 */
export async function sendSlackNotification(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('Slack notification skipped - SLACK_WEBHOOK_URL not configured');
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack API error: ${response.status} - ${body}`);
  }

  console.log('Slack notification sent successfully');
}

/**
 * Send a test message to verify Slack configuration
 */
export async function sendTestNotification() {
  const message = {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':white_check_mark: *Home Assistant Event Gateway* connected successfully!'
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Test sent at ${new Date().toISOString()}`
          }
        ]
      }
    ],
    text: 'Home Assistant Event Gateway connected successfully!'
  };

  return sendSlackNotification(message);
}
