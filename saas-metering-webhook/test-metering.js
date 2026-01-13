#!/usr/bin/env node

/*
 * SaaS Metering System Test Script v2.0
 * Tests the batch-based aggregation system
 *
 * USAGE:
 * 1. Clear collections first (events, aggregations)
 * 2. Set environment variables:
 *    export BASE_URL="https://your-project.api.codehooks.io/dev"
 *    export API_KEY="your_api_key"
 *
 * 3. Run the script:
 *    node test-metering.js
 *
 * ARCHITECTURE:
 * - Events are stored immediately with time period fields (minute, hour, day, week, month, year)
 * - Aggregations are created by cron job (every 15 min) or manual trigger
 * - Manual trigger: POST /aggregations/trigger
 */

const BASE_URL = process.env.BASE_URL;
const API_KEY = process.env.API_KEY;

if (!BASE_URL || !API_KEY) {
  console.error('❌ Error: BASE_URL and API_KEY environment variables are required');
  console.error('');
  console.error('Usage:');
  console.error('  export BASE_URL="https://your-project.api.codehooks.io/dev"');
  console.error('  export API_KEY="your_api_key"');
  console.error('  node test-metering.js');
  process.exit(1);
}

// Test data structure
const testCustomers = ['cust_test_a', 'cust_test_b', 'cust_test_c'];

const testEvents = {
  'cust_test_a': [
    { type: 'api.calls', value: 10 },
    { type: 'api.calls', value: 15 },
    { type: 'api.calls', value: 25 },
    { type: 'storage.bytes', value: 1000 },
    { type: 'storage.bytes', value: 2500 },
    { type: 'storage.bytes', value: 1500 },
    { type: 'response.time.ms', value: 100 },
    { type: 'response.time.ms', value: 200 },
    { type: 'response.time.ms', value: 150 }
  ],
  'cust_test_b': [
    { type: 'api.calls', value: 5 },
    { type: 'api.calls', value: 10 },
    { type: 'storage.bytes', value: 5000 },
    { type: 'storage.bytes', value: 3000 },
    { type: 'response.time.ms', value: 250 },
    { type: 'response.time.ms', value: 350 }
  ],
  'cust_test_c': [
    { type: 'api.calls', value: 100 },
    { type: 'storage.bytes', value: 10000 },
    { type: 'response.time.ms', value: 50 }
  ]
};

// Expected aggregations based on test data
const expectedAggregations = {
  'cust_test_a': {
    'api.calls': 50,        // sum: 10 + 15 + 25
    'storage.bytes': 2500,  // max: max(1000, 2500, 1500)
    'response.time.ms': 150 // avg: (100 + 200 + 150) / 3
  },
  'cust_test_b': {
    'api.calls': 15,        // sum: 5 + 10
    'storage.bytes': 5000,  // max: max(5000, 3000)
    'response.time.ms': 300 // avg: (250 + 350) / 2
  },
  'cust_test_c': {
    'api.calls': 100,       // sum: 100
    'storage.bytes': 10000, // max: 10000
    'response.time.ms': 50  // avg: 50
  }
};

// Helper function to make API requests
async function makeRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-apikey': API_KEY,
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

// Post a single event
async function postEvent(customerId, eventType, value) {
  const url = `${BASE_URL}/usage/${eventType}`;
  const body = { customerId, value };

  try {
    const result = await makeRequest(url, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return result;
  } catch (error) {
    console.error(`❌ Failed to post ${eventType} for ${customerId}:`, error.message);
    throw error;
  }
}

// Query events for a customer
async function queryEvents(customerId) {
  const url = `${BASE_URL}/events?customerId=${customerId}&limit=100`;
  return await makeRequest(url);
}

// Trigger aggregation manually
async function triggerAggregation() {
  const url = `${BASE_URL}/aggregations/trigger`;
  return await makeRequest(url, { method: 'POST' });
}

// Query aggregations for a customer
async function queryAggregations(customerId, period = 'daily') {
  const url = `${BASE_URL}/aggregations?customerId=${customerId}&period=${period}&limit=10`;
  return await makeRequest(url);
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Validate aggregation values
function validateAggregation(customerId, actual, expected) {
  let passed = true;
  const results = [];

  for (const [eventType, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[eventType];

    // For averages, allow small floating point differences
    const tolerance = eventType === 'response.time.ms' ? 0.01 : 0;
    const matches = Math.abs(actualValue - expectedValue) <= tolerance;

    results.push({
      eventType,
      expected: expectedValue,
      actual: actualValue,
      passed: matches
    });

    if (!matches) {
      passed = false;
    }
  }

  return { passed, results };
}

// Main test execution
async function runTests() {
  console.log('🧪 SaaS Metering System Test Suite v2.0\n');
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`🔑 API Key: ${API_KEY.substring(0, 8)}...`);
  console.log('');

  let totalTests = 0;
  let passedTests = 0;

  // Step 1: Post all test events
  console.log('📤 Step 1: Posting test events...');
  console.log('─'.repeat(50));

  for (const customerId of testCustomers) {
    const events = testEvents[customerId];
    console.log(`\n👤 Customer: ${customerId} (${events.length} events)`);

    for (const event of events) {
      try {
        await postEvent(customerId, event.type, event.value);
        console.log(`  ✅ Posted ${event.type}: ${event.value}`);
      } catch (error) {
        console.log(`  ❌ Failed to post ${event.type}: ${event.value}`);
      }
    }
  }

  // Step 2: Verify events were stored
  console.log('\n\n🔍 Step 2: Verifying events storage...');
  console.log('─'.repeat(50));

  for (const customerId of testCustomers) {
    totalTests++;
    try {
      const storedEvents = await queryEvents(customerId);
      const expectedCount = testEvents[customerId].length;

      // Check if events have time period fields
      if (storedEvents.length > 0) {
        const sampleEvent = storedEvents[0];
        const hasTimePeriods = sampleEvent.day && sampleEvent.month && sampleEvent.year;

        if (hasTimePeriods) {
          console.log(`✅ ${customerId}: Found ${storedEvents.length} events (with time fields)`);
          passedTests++;
        } else {
          console.log(`⚠️  ${customerId}: Found ${storedEvents.length} events (missing time fields!)`);
        }
      } else {
        console.log(`❌ ${customerId}: No events found (expected ${expectedCount})`);
      }
    } catch (error) {
      console.log(`❌ ${customerId}: Failed to query events - ${error.message}`);
    }
  }

  // Step 3: Trigger aggregation
  console.log('\n\n⚙️  Step 3: Triggering batch aggregation...');
  console.log('─'.repeat(50));

  try {
    const result = await triggerAggregation();
    console.log(`✅ Aggregation triggered: ${result.aggregationsCreated} aggregations created`);
  } catch (error) {
    console.log(`❌ Failed to trigger aggregation: ${error.message}`);
  }

  // Step 4: Wait a moment for processing
  console.log('\n⏳ Waiting 2 seconds for aggregation to complete...');
  await sleep(2000);

  // Step 5: Verify aggregations
  console.log('\n\n📊 Step 4: Verifying aggregations...');
  console.log('─'.repeat(50));

  for (const customerId of testCustomers) {
    console.log(`\n👤 Customer: ${customerId}`);

    try {
      const aggregations = await queryAggregations(customerId, 'daily');

      if (aggregations.length === 0) {
        console.log('  ❌ No aggregations found');
        totalTests += 3; // Count as 3 failed tests
        continue;
      }

      const dailyAgg = aggregations[0];
      const expected = expectedAggregations[customerId];
      const actual = dailyAgg.events;

      const validation = validateAggregation(customerId, actual, expected);

      for (const result of validation.results) {
        totalTests++;
        const icon = result.passed ? '✅' : '❌';
        console.log(`  ${icon} ${result.eventType}: ${result.actual} (expected: ${result.expected})`);

        if (result.passed) {
          passedTests++;
        }
      }

    } catch (error) {
      console.log(`  ❌ Failed to query aggregations - ${error.message}`);
      totalTests += 3; // Count as 3 failed tests
    }
  }

  // Final summary
  console.log('\n\n' + '═'.repeat(50));
  console.log('📈 TEST SUMMARY');
  console.log('═'.repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('');

  if (passedTests === totalTests) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Please review the output above.');
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
