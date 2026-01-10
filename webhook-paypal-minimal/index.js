import { app } from 'codehooks-js';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';

const PAYPAL_API_BASE = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Required PayPal webhook headers
const REQUIRED_HEADERS = [
  'paypal-auth-algo',
  'paypal-cert-url',
  'paypal-transmission-id',
  'paypal-transmission-sig',
  'paypal-transmission-time'
];

// Token cache
let cachedToken = null;
let tokenExpiry = 0;

// Helper to get header value (handles arrays)
function getHeader(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// Parse request body safely
function parseBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf8'));
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }
  return req.body;
}

// Get PayPal access token with caching
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal auth failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  // Cache token with 60s buffer before expiry
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// Verify webhook signature via PayPal API
async function verifyWebhookSignature(headers, body) {
  const accessToken = await getAccessToken();

  const verifyPayload = {
    auth_algo: getHeader(headers, 'paypal-auth-algo'),
    cert_url: getHeader(headers, 'paypal-cert-url'),
    transmission_id: getHeader(headers, 'paypal-transmission-id'),
    transmission_sig: getHeader(headers, 'paypal-transmission-sig'),
    transmission_time: getHeader(headers, 'paypal-transmission-time'),
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: body
  };

  const response = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(verifyPayload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal verification request failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  return result.verification_status === 'SUCCESS';
}

// Allow webhook endpoint without API key
app.auth('/webhook*', (req, res, next) => {
  next();
});

// PayPal webhook endpoint
app.post('/webhook', async (req, res) => {
  // Validate configuration
  if (!PAYPAL_WEBHOOK_ID) {
    console.error('PAYPAL_WEBHOOK_ID not configured');
    return res.status(500).send('Webhook not configured');
  }

  // Validate all required headers
  const missingHeaders = REQUIRED_HEADERS.filter(h => !getHeader(req.headers, h));
  if (missingHeaders.length > 0) {
    console.error('Missing PayPal headers:', missingHeaders.join(', '));
    return res.status(400).send(`Missing headers: ${missingHeaders.join(', ')}`);
  }

  let body;
  try {
    body = parseBody(req);
  } catch (err) {
    console.error('Failed to parse request body:', err.message);
    return res.status(400).send('Invalid request body');
  }

  try {
    const isValid = await verifyWebhookSignature(req.headers, body);

    if (!isValid) {
      console.error('Webhook signature verification failed');
      return res.status(401).send('Invalid signature');
    }

    const eventType = body.event_type;
    const eventId = body.id;
    const resource = body.resource || {};

    console.log(`PayPal event: ${eventType} (${eventId})`);

    // Handle specific events
    switch (eventType) {
      // Checkout events
      case 'CHECKOUT.ORDER.APPROVED':
        console.log('Order approved:', resource.id);
        break;
      case 'CHECKOUT.ORDER.COMPLETED':
        console.log('Order completed:', resource.id);
        break;

      // Payment capture events (REST API v2)
      case 'PAYMENT.CAPTURE.COMPLETED':
        console.log('Payment captured:', resource.id, 'Amount:', resource.amount?.value, resource.amount?.currency_code);
        break;
      case 'PAYMENT.CAPTURE.DENIED':
        console.log('Payment denied:', resource.id);
        break;
      case 'PAYMENT.CAPTURE.REFUNDED':
        console.log('Payment refunded:', resource.id);
        break;

      // Subscription events
      case 'BILLING.SUBSCRIPTION.CREATED':
        console.log('Subscription created:', resource.id, 'Plan:', resource.plan_id);
        break;
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        console.log('Subscription activated:', resource.id);
        break;
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        console.log('Subscription cancelled:', resource.id);
        break;
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        console.log('Subscription expired:', resource.id);
        break;

      // Legacy sale events (Classic API) - different resource shape
      case 'PAYMENT.SALE.COMPLETED':
        console.log('Sale completed:', resource.id, 'Amount:', resource.amount?.total, resource.amount?.currency);
        break;

      default:
        console.log(`Unhandled event: ${eventType}`, 'Resource ID:', resource.id);
    }

    // Respond quickly to avoid PayPal retries
    res.status(200).json({ received: true, event_id: eventId });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(500).send(`Webhook Error: ${err.message}`);
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'PayPal webhook handler',
    webhook_endpoint: '/webhook',
    mode: PAYPAL_MODE,
    configured: !!(PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET && PAYPAL_WEBHOOK_ID)
  });
});

export default app.init();
