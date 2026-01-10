import { app } from 'codehooks-js';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox'; // 'sandbox' or 'live'

const PAYPAL_API_BASE = PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Get PayPal access token
async function getAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  return data.access_token;
}

// Verify webhook signature via PayPal API
async function verifyWebhookSignature(headers, body) {
  const accessToken = await getAccessToken();

  const verifyPayload = {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
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

  const result = await response.json();
  return result.verification_status === 'SUCCESS';
}

// Allow webhook endpoint without API key
app.auth('/webhook', (req, res, next) => {
  next();
});

// PayPal webhook endpoint
app.post('/webhook', async (req, res) => {
  const transmissionId = req.headers['paypal-transmission-id'];

  if (!transmissionId) {
    return res.status(400).send('Missing PayPal headers');
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const isValid = await verifyWebhookSignature(req.headers, body);

    if (!isValid) {
      console.error('Webhook signature verification failed');
      return res.status(401).send('Invalid signature');
    }

    const eventType = body.event_type;
    const resource = body.resource;

    console.log(`Received PayPal event: ${eventType}`);

    // Handle specific events
    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        console.log('Payment captured:', resource.id, 'Amount:', resource.amount?.value, resource.amount?.currency_code);
        break;
      case 'PAYMENT.CAPTURE.DENIED':
        console.log('Payment denied:', resource.id);
        break;
      case 'CHECKOUT.ORDER.APPROVED':
        console.log('Order approved:', resource.id);
        break;
      case 'CHECKOUT.ORDER.COMPLETED':
        console.log('Order completed:', resource.id);
        break;
      case 'BILLING.SUBSCRIPTION.CREATED':
        console.log('Subscription created:', resource.id);
        break;
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        console.log('Subscription activated:', resource.id);
        break;
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        console.log('Subscription cancelled:', resource.id);
        break;
      case 'PAYMENT.SALE.COMPLETED':
        console.log('Sale completed:', resource.id, 'Amount:', resource.amount?.total, resource.amount?.currency);
        break;
      default:
        console.log(`Unhandled event type: ${eventType}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(500).send(`Webhook Error: ${err.message}`);
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'PayPal webhook handler',
    webhook_endpoint: '/webhook',
    mode: PAYPAL_MODE
  });
});

export default app.init();
