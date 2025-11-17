import { app } from 'codehooks-js';
import crypto from 'crypto';

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';

// Allow interactions endpoint without API key (Discord uses Ed25519 signature auth)
app.auth('/interactions', (req, res, next) => {
  next();
});

// Allow health check without API key
app.auth('/', (req, res, next) => {
  next();
});

// Verify Discord interaction signature
function verifyDiscordSignature(body, signature, timestamp) {
  if (!PUBLIC_KEY) {
    console.warn('DISCORD_PUBLIC_KEY not set - skipping verification');
    return true;
  }

  try {
    const message = timestamp + body;
    const isValid = crypto.verify(
      'sha512',
      Buffer.from(message),
      {
        key: Buffer.from(PUBLIC_KEY, 'hex'),
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      },
      Buffer.from(signature, 'hex')
    );
    return isValid;
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return false;
  }
}

// Discord interactions endpoint
app.post('/interactions', async (req, res) => {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).send('Missing signature headers');
  }

  if (!verifyDiscordSignature(req.rawBody, signature, timestamp)) {
    return res.status(401).send('Invalid signature');
  }

  const interaction = req.body;

  // Handle Discord PING
  if (interaction.type === 1) {
    return res.json({ type: 1 });
  }

  // Handle application commands
  if (interaction.type === 2) {
    console.log('Command received:', interaction.data.name);

    return res.json({
      type: 4,
      data: {
        content: `Hello! You used the ${interaction.data.name} command.`
      }
    });
  }

  // Handle message components (buttons, etc.)
  if (interaction.type === 3) {
    console.log('Component interaction:', interaction.data.custom_id);

    return res.json({
      type: 4,
      data: {
        content: 'Button clicked!'
      }
    });
  }

  res.status(400).json({ error: 'Unknown interaction type' });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Discord webhook handler',
    interactions_endpoint: '/interactions'
  });
});

export default app.init();
