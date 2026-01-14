/**
 * Event Generator Script
 *
 * Generates random, valid events for testing the SaaS Metering System.
 * Creates approximately 100 events per run for customer_1, customer_2, and customer_3.
 *
 * Installation:
 *   No dependencies required - uses native fetch (Node 18+)
 *
 * Usage:
 *   BASE_URL=https://your-project.api.codehooks.io/dev \
 *   API_KEY=your_api_key \
 *   node generate-events.js
 *
 * Options:
 *   EVENT_COUNT=100    - Total number of events to generate (default: 100)
 *   DELAY_MS=0         - Delay between events in milliseconds (default: 0)
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const API_KEY = process.env.API_KEY || '';
const EVENT_COUNT = parseInt(process.env.EVENT_COUNT || '100');
const DELAY_MS = parseInt(process.env.DELAY_MS || '0');

// Customer IDs
const CUSTOMERS = ['customer_1', 'customer_2', 'customer_3'];

// Event type configurations (from systemconfig.json)
const EVENT_TYPES = {
  'api.calls': {
    generateValue: () => 1, // Each API call counts as 1
    generateMetadata: () => ({
      method: randomChoice(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
      endpoint: randomChoice(['/api/users', '/api/orders', '/api/products', '/api/auth', '/api/search']),
      statusCode: randomChoice([200, 200, 200, 201, 204, 400, 401, 403, 404, 500]),
      userAgent: randomChoice(['Mozilla/5.0', 'curl/7.68.0', 'PostmanRuntime/7.28.0'])
    })
  },
  'storage.bytes': {
    generateValue: () => {
      // Random storage size between 1KB and 100MB
      return Math.floor(Math.random() * (104857600 - 1024) + 1024);
    },
    generateMetadata: () => ({
      fileType: randomChoice(['document', 'image', 'video', 'archive', 'code']),
      operation: randomChoice(['upload', 'update', 'snapshot']),
      location: randomChoice(['us-east-1', 'eu-west-1', 'ap-south-1'])
    })
  },
  'response.time.ms': {
    generateValue: () => {
      // Random response time between 50ms and 2000ms
      // Most responses are fast (weighted towards lower values)
      const random = Math.random();
      if (random < 0.7) {
        // 70% of requests: 50-300ms (fast)
        return Math.floor(Math.random() * (300 - 50) + 50);
      } else if (random < 0.95) {
        // 25% of requests: 300-1000ms (medium)
        return Math.floor(Math.random() * (1000 - 300) + 300);
      } else {
        // 5% of requests: 1000-2000ms (slow)
        return Math.floor(Math.random() * (2000 - 1000) + 1000);
      }
    },
    generateMetadata: () => ({
      endpoint: randomChoice(['/api/users', '/api/orders', '/api/products', '/api/search', '/api/reports']),
      region: randomChoice(['us-east-1', 'eu-west-1', 'ap-south-1']),
      cached: randomChoice([true, false])
    })
  }
};

/**
 * Helper function to pick random element from array
 */
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate a random event
 */
function generateRandomEvent() {
  const customerId = randomChoice(CUSTOMERS);
  const eventType = randomChoice(Object.keys(EVENT_TYPES));
  const eventConfig = EVENT_TYPES[eventType];

  return {
    customerId,
    eventType,
    value: eventConfig.generateValue(),
    metadata: eventConfig.generateMetadata()
  };
}

/**
 * Send event to API
 */
async function sendEvent(event) {
  const url = `${BASE_URL}/usage/${event.eventType}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-apikey': API_KEY
      },
      body: JSON.stringify({
        customerId: event.customerId,
        value: event.value,
        metadata: event.metadata
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }

    const result = await response.json();
    return { success: true, event, result };
  } catch (error) {
    return { success: false, event, error: error.message };
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Event Generator');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Base URL:      ${BASE_URL}`);
  console.log(`API Key:       ${API_KEY ? '***' + API_KEY.slice(-4) : '(not set)'}`);
  console.log(`Event Count:   ${EVENT_COUNT}`);
  console.log(`Delay:         ${DELAY_MS}ms`);
  console.log(`Customers:     ${CUSTOMERS.join(', ')}`);
  console.log(`Event Types:   ${Object.keys(EVENT_TYPES).join(', ')}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (!API_KEY) {
    console.error('❌ Error: API_KEY environment variable is required');
    process.exit(1);
  }

  const stats = {
    total: 0,
    success: 0,
    failed: 0,
    byCustomer: {},
    byEventType: {}
  };

  // Initialize counters
  CUSTOMERS.forEach(c => stats.byCustomer[c] = 0);
  Object.keys(EVENT_TYPES).forEach(e => stats.byEventType[e] = 0);

  console.log(`Generating ${EVENT_COUNT} events...\n`);

  const startTime = Date.now();

  for (let i = 0; i < EVENT_COUNT; i++) {
    const event = generateRandomEvent();
    const result = await sendEvent(event);

    stats.total++;

    if (result.success) {
      stats.success++;
      stats.byCustomer[event.customerId]++;
      stats.byEventType[event.eventType]++;

      const valueFormatted = event.eventType === 'storage.bytes'
        ? `${(event.value / 1048576).toFixed(2)} MB`
        : event.value;

      console.log(`✅ [${i + 1}/${EVENT_COUNT}] ${event.eventType} for ${event.customerId} (value: ${valueFormatted})`);
    } else {
      stats.failed++;
      console.error(`❌ [${i + 1}/${EVENT_COUNT}] Failed: ${result.error}`);
    }

    if (DELAY_MS > 0 && i < EVENT_COUNT - 1) {
      await sleep(DELAY_MS);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('📊 Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Total Events:  ${stats.total}`);
  console.log(`Success:       ${stats.success} ✅`);
  console.log(`Failed:        ${stats.failed} ❌`);
  console.log(`Duration:      ${duration}s`);
  console.log(`Rate:          ${(stats.total / parseFloat(duration)).toFixed(2)} events/sec`);
  console.log('\nBy Customer:');
  Object.entries(stats.byCustomer).forEach(([customer, count]) => {
    const percentage = ((count / stats.success) * 100).toFixed(1);
    console.log(`  ${customer}: ${count} (${percentage}%)`);
  });
  console.log('\nBy Event Type:');
  Object.entries(stats.byEventType).forEach(([eventType, count]) => {
    const percentage = ((count / stats.success) * 100).toFixed(1);
    console.log(`  ${eventType}: ${count} (${percentage}%)`);
  });
  console.log('═══════════════════════════════════════════════════\n');

  if (stats.failed > 0) {
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
