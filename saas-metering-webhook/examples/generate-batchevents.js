/**
 * Example script to generate and send batch usage events
 *
 * Usage:
 *   node example/generate-batchevents.js [options]
 *
 * Options:
 *   --url        API base URL (default: http://localhost:3000 or BASE_URL env)
 *   --token      API token (default: API_KEY env)
 *   --count      Number of events to generate (default: 10)
 *   --customers  Number of unique customers (default: 3)
 *   --dry-run    Print events without sending
 *
 * Examples:
 *   node example/generate-batchevents.js --count 50 --customers 5
 *   node example/generate-batchevents.js --url https://myapp-xxxx.api.codehooks.io --token abc123
 *   node example/generate-batchevents.js --dry-run
 */

const EVENT_TYPES = [
  { type: 'api.calls', minValue: 1, maxValue: 100 },
  { type: 'storage.bytes', minValue: 1000, maxValue: 1000000 },
  { type: 'response.time.ms', minValue: 10, maxValue: 500 }
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: process.env.BASE_URL || 'http://localhost:3000',
    token: process.env.API_KEY || '',
    count: 10,
    customers: 3,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        options.url = args[++i];
        break;
      case '--token':
        options.token = args[++i];
        break;
      case '--count':
        options.count = parseInt(args[++i], 10);
        break;
      case '--customers':
        options.customers = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
    }
  }

  return options;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCustomerIds(count) {
  const customers = [];
  for (let i = 1; i <= count; i++) {
    customers.push(`customer-${String(i).padStart(3, '0')}`);
  }
  return customers;
}

function generateEvents(count, customerIds) {
  const events = [];

  for (let i = 0; i < count; i++) {
    const eventConfig = randomChoice(EVENT_TYPES);
    const customerId = randomChoice(customerIds);

    events.push({
      eventType: eventConfig.type,
      customerId: customerId,
      value: randomInt(eventConfig.minValue, eventConfig.maxValue),
      metadata: {
        source: 'generate-batchevents',
        batchIndex: i
      }
    });
  }

  return events;
}

async function sendBatch(url, token, events) {
  const endpoint = `${url.replace(/\/$/, '')}/usagebatch`;

  const headers = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers['x-apikey'] = token;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(events)
  });

  const data = await response.json();
  return { status: response.status, data };
}

async function main() {
  const options = parseArgs();
  const customerIds = generateCustomerIds(options.customers);
  const events = generateEvents(options.count, customerIds);

  console.log(`Generated ${events.length} events for ${customerIds.length} customers`);
  console.log(`Event types: ${EVENT_TYPES.map(e => e.type).join(', ')}`);
  console.log('');

  if (options.dryRun) {
    console.log('Dry run - events that would be sent:');
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  console.log(`Sending to: ${options.url}/usagebatch`);

  try {
    const { status, data } = await sendBatch(options.url, options.token, events);

    if (status >= 200 && status < 300) {
      console.log(`Success (${status}):`, data);
    } else {
      console.error(`Error (${status}):`, data);
      process.exit(1);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
    process.exit(1);
  }
}

main();
