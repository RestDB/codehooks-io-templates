import { app } from 'codehooks-js';
import crypto from 'crypto';

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';

// Ed25519 OID prefix for DER encoding
const ED25519_OID_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// Allow interactions endpoint without API key (Discord uses Ed25519 signature auth)
app.auth('/interactions', (req, res, next) => {
  next();
});

// Allow health check without API key
app.auth('/', (req, res, next) => {
  next();
});

// Verify Discord interaction signature (Ed25519)
function verifyDiscordSignature(body, signature, timestamp) {
  if (!PUBLIC_KEY) {
    console.error('DISCORD_PUBLIC_KEY not configured');
    return false;
  }

  try {
    // Create Ed25519 public key from hex string
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_OID_PREFIX, Buffer.from(PUBLIC_KEY, 'hex')]),
      format: 'der',
      type: 'spki'
    });

    // Discord signature is over: timestamp + body
    const message = Buffer.from(timestamp + body);
    const sig = Buffer.from(signature, 'hex');

    // Ed25519 uses null algorithm (signature includes hash)
    return crypto.verify(null, message, publicKey, sig);
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

  // Handle Discord PING (required for endpoint verification)
  if (interaction.type === 1) {
    return res.json({ type: 1 });
  }

  // Handle application commands (slash commands)
  if (interaction.type === 2) {
    console.log('Command received:', interaction.data.name);

    return res.json({
      type: 4,
      data: {
        content: `Hello! You used the ${interaction.data.name} command.`
      }
    });
  }

  // Handle message components (buttons, select menus)
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
    interactions_endpoint: '/interactions',
    configured: !!PUBLIC_KEY
  });
});

export default app.init();
