/**
 * Optional AI explanation module for Home Assistant events
 *
 * This module provides LLM-powered explanations for notable events.
 * It supports both OpenAI and Anthropic Claude APIs.
 *
 * IMPORTANT SAFETY NOTES:
 * - The LLM is ONLY used to explain or classify events
 * - The LLM has NO ability to control Home Assistant devices
 * - The LLM receives read-only event data
 * - If no API key is configured, the system works without AI
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Check if AI is enabled (any provider configured)
 */
export function isAIEnabled() {
  return !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
}

/**
 * Get the configured AI provider
 */
function getAIProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

// ============================================================================
// PROMPT ENGINEERING
// ============================================================================

/**
 * Build the system prompt for event explanation
 * The prompt is intentionally restrictive about what the LLM can do
 */
function buildSystemPrompt() {
  return `You are a Home Assistant event analyst. Your ONLY job is to provide brief, helpful explanations of home automation events.

RULES:
1. You can ONLY read and explain events - you cannot control any devices
2. Keep explanations to 2-3 sentences maximum
3. Focus on what the event means for the homeowner
4. If the event might indicate a problem, mention it briefly
5. Be factual and avoid speculation
6. Do not suggest actions that require device control

You receive event data in JSON format and provide a plain text explanation.`;
}

/**
 * Build the user prompt with event details
 */
function buildUserPrompt(event, notableReasons) {
  const eventSummary = {
    entity_id: event.entity_id,
    event_type: event.event_type,
    state: event.state,
    timestamp: event.timestamp,
    time_context: event.hour_of_day >= 22 || event.hour_of_day < 6 ? 'night' : 'day',
    notable_reasons: notableReasons
  };

  return `Explain this Home Assistant event briefly (2-3 sentences):

${JSON.stringify(eventSummary, null, 2)}`;
}

// ============================================================================
// API CLIENTS
// ============================================================================

/**
 * Call OpenAI API
 */
async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 150,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${body}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropic(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 150,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${body}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || null;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Generate an AI explanation for a notable event
 *
 * @param {Object} event - The Home Assistant event
 * @param {Array} notableReasons - Why this event was flagged as notable
 * @returns {Promise<string|null>} The explanation, or null if AI is disabled/fails
 */
export async function generateEventExplanation(event, notableReasons) {
  const provider = getAIProvider();

  if (!provider) {
    return null;
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(event, notableReasons);

  try {
    let explanation;

    if (provider === 'openai') {
      explanation = await callOpenAI(systemPrompt, userPrompt);
    } else if (provider === 'anthropic') {
      explanation = await callAnthropic(systemPrompt, userPrompt);
    }

    if (explanation) {
      console.log(`AI explanation generated (${provider})`);
    }

    return explanation;

  } catch (error) {
    console.error(`AI explanation failed (${provider}):`, error.message);
    // Return null instead of throwing - AI is optional
    return null;
  }
}

/**
 * Get AI provider status for health checks
 */
export function getAIStatus() {
  const provider = getAIProvider();

  return {
    enabled: !!provider,
    provider: provider || 'none',
    model: provider === 'openai'
      ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
      : provider === 'anthropic'
        ? (process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307')
        : null
  };
}
