#!/usr/bin/env node

import { execSync } from 'child_process';

/*
 * Comprehensive Aggregation Test Suite
 * Tests all aggregation operators with known datasets to verify 100% correctness
 *
 * USAGE:
 *   export BASE_URL="https://your-project.api.codehooks.io/dev"
 *   export API_KEY="your_api_key"
 *   node test-aggregation.js
 *
 * WHAT THIS TEST DOES:
 * 1. Drops events and aggregations collections
 * 2. Populates known test data for each operator
 * 3. Triggers aggregation
 * 4. Verifies results against mathematically expected values
 *
 * OPERATORS TESTED:
 * - sum: adds all values
 * - avg: calculates arithmetic mean
 * - min: finds minimum value
 * - max: finds maximum value
 * - count: counts number of events
 * - first: returns first value (by receivedAt)
 * - last: returns last value (by receivedAt)
 */

const BASE_URL = process.env.BASE_URL;
const API_KEY = process.env.API_KEY;

if (!BASE_URL || !API_KEY) {
  console.error('Error: BASE_URL and API_KEY environment variables are required');
  console.error('');
  console.error('Usage:');
  console.error('  export BASE_URL="https://your-project.api.codehooks.io/dev"');
  console.error('  export API_KEY="your_api_key"');
  console.error('  node test-aggregation.js');
  process.exit(1);
}

// Complete test configuration - maps event types to operators and test values
// This matches the systemconfig.json with all operators
const TEST_CONFIG = {
  // sum operator: adds all values
  'api.calls': {
    op: 'sum',
    testValues: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    // Calculation: 10 + 20 + 30 + 40 + 50 + 60 + 70 + 80 + 90 + 100 = 550
    expectedValue: 550
  },
  // max operator: finds maximum value
  'storage.bytes': {
    op: 'max',
    testValues: [1000, 5000, 2500, 3000, 4500, 1500, 6000, 2000, 3500, 4000],
    // Calculation: max(...) = 6000
    expectedValue: 6000
  },
  // avg operator: calculates arithmetic mean
  'response.time.ms': {
    op: 'avg',
    testValues: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    // Calculation: (100 + 200 + ... + 1000) / 10 = 550
    expectedValue: 550
  },
  // min operator: finds minimum value
  'test.min': {
    op: 'min',
    testValues: [50, 10, 30, 20, 45, 15, 35, 25, 40, 5],
    // Calculation: min(...) = 5
    expectedValue: 5
  },
  // count operator: counts number of events
  'test.count': {
    op: 'count',
    testValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    // Calculation: 10 events
    expectedValue: 10
  },
  // first operator: returns first value (by receivedAt timestamp)
  'test.first': {
    op: 'first',
    testValues: [111, 222, 333, 444, 555, 666, 777, 888, 999, 1000],
    // Calculation: first value in order = 111
    expectedValue: 111
  },
  // last operator: returns last value (by receivedAt timestamp)
  'test.last': {
    op: 'last',
    testValues: [100, 200, 300, 400, 500, 600, 700, 800, 900, 999],
    // Calculation: last value in order = 999
    expectedValue: 999
  }
};

// Edge case tests - additional test cases for robustness
const EDGE_CASE_TESTS = {
  // Test with negative values
  'sum_negative': {
    eventType: 'api.calls',
    op: 'sum',
    testValues: [-10, 20, -5, 15, -8, 12, -3, 9, -7, 17],
    // Calculation: -10 + 20 + (-5) + 15 + (-8) + 12 + (-3) + 9 + (-7) + 17 = 40
    expectedValue: 40
  },
  // Test with decimal values
  'avg_decimals': {
    eventType: 'response.time.ms',
    op: 'avg',
    testValues: [10.5, 20.5, 30.5, 40.5, 50.5, 60.5, 70.5, 80.5, 90.5, 100.5],
    // Calculation: (10.5 + 20.5 + ... + 100.5) / 10 = 55.5
    expectedValue: 55.5
  },
  // Test with single value
  'single_value_sum': {
    eventType: 'api.calls',
    op: 'sum',
    testValues: [42],
    // Calculation: 42
    expectedValue: 42
  },
  // Test with zeros
  'zeros_max': {
    eventType: 'storage.bytes',
    op: 'max',
    testValues: [0, 0, 0, 100, 0, 0, 0, 50, 0, 0],
    // Calculation: max(...) = 100
    expectedValue: 100
  },
  // Test min with negative
  'min_with_negative': {
    eventType: 'test.min',
    op: 'min',
    testValues: [5, -3, 10, -1, 8, -5, 12, -2, 7, -4],
    // Calculation: min(...) = -5
    expectedValue: -5
  }
};

const TEST_CUSTOMER_ID = 'test_agg_main';
const EDGE_CUSTOMER_ID = 'test_agg_edge';

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

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

// Drop a collection using coho CLI (pipes 'yes' to confirm)
async function dropCollection(collection) {
  try {
    console.log(`    Dropping collection: ${collection}`);
    execSync(`yes | coho dropcollection ${collection}`, { stdio: 'pipe' });
    await sleep(500);
    return true;
  } catch (error) {
    // Collection might not exist, which is fine
    console.log(`    (${collection} may not exist)`);
    return false;
  }
}

// Post a single event
async function postEvent(customerId, eventType, value) {
  const url = `${BASE_URL}/usage/${eventType}`;
  const body = { customerId, value };

  return await makeRequest(url, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

// Trigger aggregation
async function triggerAggregation() {
  const url = `${BASE_URL}/aggregations/trigger`;
  return await makeRequest(url, { method: 'POST' });
}

// Query aggregations for a customer
async function queryAggregations(customerId, period = 'daily') {
  const url = `${BASE_URL}/aggregations?customerId=${customerId}&period=${period}&limit=10`;
  return await makeRequest(url);
}

// Get system configuration
async function getConfig() {
  const url = `${BASE_URL}/config`;
  return await makeRequest(url);
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate expected value based on operator
function calculateExpectedValue(op, values) {
  if (values.length === 0) return null;
  switch (op) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'count':
      return values.length;
    case 'first':
      return values[0];
    case 'last':
      return values[values.length - 1];
    default:
      throw new Error(`Unknown operator: ${op}`);
  }
}

// Compare values with tolerance for floating point
function valuesMatch(actual, expected, tolerance = 0.0001) {
  if (actual === undefined || actual === null) return false;
  if (typeof actual !== 'number' || typeof expected !== 'number') {
    return actual === expected;
  }
  return Math.abs(actual - expected) <= tolerance;
}

// Run main operator tests
async function runMainTests(config) {
  console.log('\n' + '='.repeat(60));
  console.log('MAIN OPERATOR TESTS');
  console.log('='.repeat(60));

  let totalTests = 0;
  let passedTests = 0;
  const failedTests = [];

  // Build active tests based on available event types in config
  const activeTests = {};
  for (const [eventType, testConfig] of Object.entries(TEST_CONFIG)) {
    if (config.events[eventType]) {
      const actualOp = config.events[eventType].op;
      if (actualOp !== testConfig.op) {
        console.log(`  WARNING: ${eventType} has operator '${actualOp}' in config but test expects '${testConfig.op}'`);
      }
      activeTests[eventType] = {
        ...testConfig,
        op: actualOp,
        expectedValue: calculateExpectedValue(actualOp, testConfig.testValues)
      };
    }
  }

  if (Object.keys(activeTests).length === 0) {
    console.log('  No matching event types found. Please update systemconfig.json.');
    return { totalTests: 0, passedTests: 0, failedTests: [] };
  }

  // Step 1: Drop collections
  console.log('\nStep 1: Clearing test data...');
  await dropCollection('events');
  await dropCollection('aggregations');
  await sleep(500);

  // Step 2: Post test events
  console.log('\nStep 2: Posting test events...');
  for (const [eventType, testConfig] of Object.entries(activeTests)) {
    console.log(`  ${eventType} (${testConfig.op}): posting ${testConfig.testValues.length} events`);
    for (const value of testConfig.testValues) {
      try {
        await postEvent(TEST_CUSTOMER_ID, eventType, value);
        // Delay to ensure correct ordering for first/last
        await sleep(100);
      } catch (error) {
        console.log(`    ERROR posting value ${value}: ${error.message}`);
      }
    }
  }

  // Step 3: Trigger aggregation
  console.log('\nStep 3: Triggering aggregation...');
  await sleep(500);
  try {
    const result = await triggerAggregation();
    console.log(`  Created ${result.aggregationsCreated} aggregations`);
  } catch (error) {
    console.log(`  ERROR: ${error.message}`);
  }

  // Step 4: Wait and query results
  console.log('\nStep 4: Waiting for aggregation to complete...');
  await sleep(2000);

  let aggregations;
  try {
    aggregations = await queryAggregations(TEST_CUSTOMER_ID, 'daily');
  } catch (error) {
    console.log(`  ERROR querying aggregations: ${error.message}`);
    return { totalTests, passedTests, failedTests };
  }

  if (!aggregations || aggregations.length === 0) {
    console.log('  ERROR: No aggregations found!');
    return { totalTests, passedTests, failedTests };
  }

  const agg = aggregations[0];
  console.log(`  Found aggregation: ${agg._id}`);

  // Step 5: Verify results
  console.log('\nStep 5: Verifying results...');
  console.log('-'.repeat(60));

  for (const [eventType, testConfig] of Object.entries(activeTests)) {
    totalTests++;
    const actualValue = agg.events[eventType];
    const expectedValue = testConfig.expectedValue;

    const passed = valuesMatch(actualValue, expectedValue);
    const status = passed ? 'PASS' : 'FAIL';

    console.log(`\n[${status}] ${eventType} (${testConfig.op})`);
    console.log(`  Input values: [${testConfig.testValues.join(', ')}]`);
    console.log(`  Expected: ${expectedValue}`);
    console.log(`  Actual: ${actualValue}`);

    if (passed) {
      passedTests++;
    } else {
      failedTests.push({ eventType, op: testConfig.op, expected: expectedValue, actual: actualValue });
    }
  }

  // Also verify event counts
  console.log('\n' + '-'.repeat(60));
  console.log('Event Count Verification:');

  for (const [eventType, testConfig] of Object.entries(activeTests)) {
    totalTests++;
    const actualCount = agg.eventCounts?.[eventType];
    const expectedCount = testConfig.testValues.length;

    const passed = actualCount === expectedCount;
    const status = passed ? 'PASS' : 'FAIL';

    console.log(`  [${status}] ${eventType}: ${actualCount}/${expectedCount} events`);

    if (passed) {
      passedTests++;
    } else {
      failedTests.push({ eventType: `${eventType} (count)`, expected: expectedCount, actual: actualCount });
    }
  }

  return { totalTests, passedTests, failedTests };
}

// Run edge case tests
async function runEdgeCaseTests(config) {
  console.log('\n' + '='.repeat(60));
  console.log('EDGE CASE TESTS');
  console.log('='.repeat(60));

  let totalTests = 0;
  let passedTests = 0;
  const failedTests = [];

  // Step 1: Clear data
  console.log('\nStep 1: Clearing test data...');
  await dropCollection('events');
  await dropCollection('aggregations');
  await sleep(500);

  // Step 2: Post edge case events
  console.log('\nStep 2: Posting edge case events...');

  // Group edge cases by event type to aggregate together
  const eventsByType = {};
  for (const [testName, testConfig] of Object.entries(EDGE_CASE_TESTS)) {
    if (!config.events[testConfig.eventType]) {
      console.log(`  Skipping ${testName}: event type ${testConfig.eventType} not in config`);
      continue;
    }

    if (!eventsByType[testConfig.eventType]) {
      eventsByType[testConfig.eventType] = [];
    }
    eventsByType[testConfig.eventType].push({ testName, ...testConfig });
  }

  // For edge cases, we'll test them one at a time with separate customers
  let edgeCaseNum = 0;
  for (const [testName, testConfig] of Object.entries(EDGE_CASE_TESTS)) {
    if (!config.events[testConfig.eventType]) continue;

    edgeCaseNum++;
    const customerId = `${EDGE_CUSTOMER_ID}_${edgeCaseNum}`;

    console.log(`\n  Test: ${testName}`);
    console.log(`    Event type: ${testConfig.eventType} (${testConfig.op})`);
    console.log(`    Values: [${testConfig.testValues.join(', ')}]`);
    console.log(`    Customer: ${customerId}`);

    for (const value of testConfig.testValues) {
      try {
        await postEvent(customerId, testConfig.eventType, value);
        await sleep(100);
      } catch (error) {
        console.log(`    ERROR posting value ${value}: ${error.message}`);
      }
    }

    // Store test info for verification
    testConfig.customerId = customerId;
  }

  // Step 3: Trigger aggregation
  console.log('\nStep 3: Triggering aggregation...');
  await sleep(500);
  try {
    const result = await triggerAggregation();
    console.log(`  Created ${result.aggregationsCreated} aggregations`);
  } catch (error) {
    console.log(`  ERROR: ${error.message}`);
  }

  // Step 4: Wait and verify
  console.log('\nStep 4: Waiting for aggregation...');
  await sleep(2000);

  console.log('\nStep 5: Verifying edge case results...');
  console.log('-'.repeat(60));

  edgeCaseNum = 0;
  for (const [testName, testConfig] of Object.entries(EDGE_CASE_TESTS)) {
    if (!config.events[testConfig.eventType]) continue;

    edgeCaseNum++;
    totalTests++;

    const customerId = `${EDGE_CUSTOMER_ID}_${edgeCaseNum}`;
    const actualOp = config.events[testConfig.eventType].op;
    const expectedValue = calculateExpectedValue(actualOp, testConfig.testValues);

    let aggregations;
    try {
      aggregations = await queryAggregations(customerId, 'daily');
    } catch (error) {
      console.log(`\n[FAIL] ${testName}: Error querying - ${error.message}`);
      failedTests.push({ eventType: testName, expected: expectedValue, actual: 'ERROR' });
      continue;
    }

    if (!aggregations || aggregations.length === 0) {
      console.log(`\n[FAIL] ${testName}: No aggregation found`);
      failedTests.push({ eventType: testName, expected: expectedValue, actual: 'NO DATA' });
      continue;
    }

    const agg = aggregations[0];
    const actualValue = agg.events[testConfig.eventType];
    const passed = valuesMatch(actualValue, expectedValue);

    const status = passed ? 'PASS' : 'FAIL';
    console.log(`\n[${status}] ${testName}`);
    console.log(`  Event type: ${testConfig.eventType} (${actualOp})`);
    console.log(`  Input: [${testConfig.testValues.join(', ')}]`);
    console.log(`  Expected: ${expectedValue}`);
    console.log(`  Actual: ${actualValue}`);

    if (passed) {
      passedTests++;
    } else {
      failedTests.push({ eventType: testName, expected: expectedValue, actual: actualValue });
    }
  }

  return { totalTests, passedTests, failedTests };
}

// Main test execution
async function runTests() {
  console.log('='.repeat(60));
  console.log('COMPREHENSIVE AGGREGATION TEST SUITE');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Get system configuration
  console.log('\nFetching system configuration...');
  let config;
  try {
    config = await getConfig();
    console.log('\nConfigured event types:');
    for (const [eventType, eventConfig] of Object.entries(config.events)) {
      console.log(`  - ${eventType}: ${eventConfig.op}`);
    }
  } catch (error) {
    console.error(`FATAL: Could not fetch config: ${error.message}`);
    process.exit(1);
  }

  // Run main tests
  const mainResults = await runMainTests(config);

  // Run edge case tests
  const edgeResults = await runEdgeCaseTests(config);

  // Final summary
  const totalTests = mainResults.totalTests + edgeResults.totalTests;
  const passedTests = mainResults.passedTests + edgeResults.passedTests;
  const allFailedTests = [...mainResults.failedTests, ...edgeResults.failedTests];

  console.log('\n' + '='.repeat(60));
  console.log('FINAL TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`\nMain Operator Tests: ${mainResults.passedTests}/${mainResults.totalTests} passed`);
  console.log(`Edge Case Tests: ${edgeResults.passedTests}/${edgeResults.totalTests} passed`);
  console.log(`\nTotal Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`);

  if (allFailedTests.length > 0) {
    console.log('\nFailed Tests:');
    for (const failure of allFailedTests) {
      console.log(`  - ${failure.eventType}: expected ${failure.expected}, got ${failure.actual}`);
    }
  }

  console.log('');
  if (passedTests === totalTests && totalTests > 0) {
    console.log('SUCCESS: All aggregation tests passed!');
    console.log('Aggregation operators verified as 100% correct.');
    process.exit(0);
  } else if (totalTests === 0) {
    console.log('WARNING: No tests were run. Check your configuration.');
    process.exit(1);
  } else {
    console.log('FAILURE: Some tests did not pass.');
    console.log('Please review the aggregation logic in index.js:performAggregation()');
    process.exit(1);
  }
}

// Run the tests
runTests().catch(error => {
  console.error('\nFATAL ERROR:', error);
  process.exit(1);
});
