import { app } from 'codehooks-js';
import crypto from 'crypto';

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';

// Verify Shopify webhook signature
function verifyShopifySignature(payload, hmacHeader) {
  if (!SHOPIFY_SECRET) {
    console.warn('SHOPIFY_WEBHOOK_SECRET not set - skipping verification');
    return true;
  }

  const hash = crypto
    .createHmac('sha256', SHOPIFY_SECRET)
    .update(payload, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}

// Shopify webhook endpoint
app.post('/webhook', async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const topic = req.headers['x-shopify-topic'];
  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (!hmac) {
    return res.status(401).send('Missing HMAC signature');
  }

  if (!verifyShopifySignature(req.rawBody, hmac)) {
    return res.status(401).send('Invalid signature');
  }

  console.log(`Received Shopify webhook: ${topic} from ${shopDomain}`);

  // Handle specific topics
  switch (topic) {
    case 'orders/create':
      console.log('New order:', req.body.id, 'Total:', req.body.total_price);
      break;
    case 'orders/paid':
      console.log('Order paid:', req.body.id);
      break;
    case 'orders/fulfilled':
      console.log('Order fulfilled:', req.body.id);
      break;
    case 'orders/cancelled':
      console.log('Order cancelled:', req.body.id);
      break;
    case 'products/create':
      console.log('Product created:', req.body.id, req.body.title);
      break;
    case 'products/update':
      console.log('Product updated:', req.body.id, req.body.title);
      break;
    case 'customers/create':
      console.log('Customer created:', req.body.id, req.body.email);
      break;
    default:
      console.log(`Unhandled topic: ${topic}`);
  }

  res.status(200).json({ received: true });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Shopify webhook handler',
    webhook_endpoint: '/webhook'
  });
});

export default app.init();
