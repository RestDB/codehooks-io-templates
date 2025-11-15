import { app, Datastore } from 'codehooks-js';
import Stripe from 'stripe';

// Initialize Stripe - you'll need to set STRIPE_WEBHOOK_SECRET as an environment variable
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2019-08-14' as any
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Allow webhook endpoint without API key (Stripe uses signature auth)
app.auth('/webhook', (req, res, next) => {
  next(); // Allow through - we'll verify the Stripe signature in the handler
});

// Stripe webhook endpoint
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    console.error('Missing stripe-signature header');
    return res.status(400).send('Missing signature');
  }

  if (!WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event: Stripe.Event;

  try {
    // Verify the webhook signature using rawBody
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      WEBHOOK_SECRET
    );
  } catch (err) {
    const error = err as Error;
    console.error('Webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  // Log the event to console
  console.log('Received Stripe webhook event:', {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode
  });

  try {
    // Store the event in the database
    const conn = await Datastore.open();

    await conn.insertOne('stripe_events', {
      event_id: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
      data: event.data,
      api_version: event.api_version,
      request: event.request,
      received_at: new Date().toISOString()
    });

    console.log(`Event ${event.id} stored successfully`);
  } catch (err) {
    const error = err as Error;
    console.error('Failed to store event in database:', error.message);
    // Still return 200 to Stripe to avoid retries
  }

  // Return 200 to acknowledge receipt
  res.status(200).json({ received: true, event_id: event.id });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Stripe webhook handler is running',
    webhook_endpoint: '/webhook'
  });
});

// MANDATORY: bind to serverless runtime
export default app.init();
