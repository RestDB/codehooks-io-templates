import { app } from 'codehooks-js';
import { Webhook } from 'svix';

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || '';

// Allow webhook endpoint without API key (Clerk uses Svix signature auth)
app.auth('/webhook', (req, res, next) => {
  next();
});

// Allow health check without API key
app.auth('/', (req, res, next) => {
  next();
});

// Clerk webhook endpoint
app.post('/webhook', async (req, res) => {
  if (!WEBHOOK_SECRET) {
    console.warn('CLERK_WEBHOOK_SECRET not set');
    return res.status(500).send('Webhook secret not configured');
  }

  // Get Svix headers
  const svixId = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).send('Missing Svix headers');
  }

  let event;

  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    event = wh.verify(req.rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return res.status(400).send('Invalid signature');
  }

  console.log(`Received Clerk event: ${event.type}`);

  // Handle specific events
  switch (event.type) {
    case 'user.created':
      console.log('User created:', event.data.id, event.data.email_addresses[0]?.email_address);
      break;
    case 'user.updated':
      console.log('User updated:', event.data.id);
      break;
    case 'user.deleted':
      console.log('User deleted:', event.data.id);
      break;
    case 'session.created':
      console.log('Session created:', event.data.id, 'User:', event.data.user_id);
      break;
    case 'session.ended':
      console.log('Session ended:', event.data.id);
      break;
    case 'organization.created':
      console.log('Organization created:', event.data.id, event.data.name);
      break;
    case 'organizationMembership.created':
      console.log('Member added to org:', event.data.organization_id);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).json({ received: true });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Clerk webhook handler',
    webhook_endpoint: '/webhook'
  });
});

export default app.init();
