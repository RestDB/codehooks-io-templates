import { app } from 'codehooks-js';
import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

// Allow webhook endpoint without API key (GitHub uses HMAC signature auth)
app.auth('/webhook', (req, res, next) => {
  next();
});

// Allow health check without API key
app.auth('/', (req, res, next) => {
  next();
});

// Verify GitHub webhook signature
function verifyGitHubSignature(payload, signature) {
  if (!WEBHOOK_SECRET) {
    console.warn('GITHUB_WEBHOOK_SECRET not set - skipping verification');
    return true;
  }

  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// GitHub webhook endpoint
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];

  if (!signature) {
    return res.status(401).send('Missing signature');
  }

  if (!verifyGitHubSignature(req.rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  console.log(`Received GitHub ${event} event:`, {
    repository: req.body.repository?.full_name,
    sender: req.body.sender?.login,
    action: req.body.action
  });

  // Handle specific events
  switch (event) {
    case 'push':
      console.log('Push to:', req.body.ref);
      console.log('Commits:', req.body.commits?.length);
      break;
    case 'pull_request':
      console.log('PR action:', req.body.action);
      console.log('PR title:', req.body.pull_request?.title);
      break;
    case 'issues':
      console.log('Issue action:', req.body.action);
      console.log('Issue title:', req.body.issue?.title);
      break;
    default:
      console.log('Event type:', event);
  }

  res.status(200).json({ received: true });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'GitHub webhook handler',
    webhook_endpoint: '/webhook'
  });
});

export default app.init();
