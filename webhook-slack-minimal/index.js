import { app } from 'codehooks-js';
import crypto from 'crypto';

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// Allow webhook endpoint without API key
app.auth('/webhook', (req, res, next) => {
  next();
});

// Allow health check without API key
app.auth('/', (req, res, next) => {
  next();
});

// Verify Slack request signature
function verifySlackSignature(body, signature, timestamp) {
  if (!SIGNING_SECRET) {
    console.warn('SLACK_SIGNING_SECRET not set - skipping verification');
    return true;
  }

  // Reject old requests (older than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    console.error('Request timestamp too old');
    return false;
  }

  // Compute the signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(sigBasestring, 'utf8')
    .digest('hex');

  // Compare signatures
  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return false;
  }
}

// Slack events webhook endpoint
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).send('Missing Slack signature headers');
  }

  if (!verifySlackSignature(req.rawBody, signature, timestamp)) {
    return res.status(401).send('Invalid signature');
  }

  const body = req.body;

  // Handle URL verification challenge
  if (body.type === 'url_verification') {
    console.log('URL verification challenge received');
    return res.json({ challenge: body.challenge });
  }

  // Handle event callbacks
  if (body.type === 'event_callback') {
    const event = body.event;

    console.log('Event received:', event.type);

    // Handle message events
    if (event.type === 'message' && !event.bot_id && event.text) {
      console.log('Message from:', event.user);
      console.log('Text:', event.text);

      // Echo the message back
      // Note: In a real app, you'd use the Slack Web API to post messages
      // This just logs the echo. Add Slack Web API integration to actually post.
      console.log('Echo:', event.text);

      // Respond quickly to Slack (within 3 seconds)
      return res.status(200).send('OK');
    }

    return res.status(200).send('OK');
  }

  res.status(400).json({ error: 'Unknown event type' });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Slack webhook handler',
    webhook_endpoint: '/webhook'
  });
});

export default app.init();
