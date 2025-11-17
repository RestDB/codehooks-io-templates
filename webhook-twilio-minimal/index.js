import { app } from 'codehooks-js';
import crypto from 'crypto';

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

// Allow webhook endpoint without API key (Twilio uses HMAC signature auth)
app.auth('/webhook', (req, res, next) => {
  next();
});

// Allow health check without API key
app.auth('/', (req, res, next) => {
  next();
});

// Verify Twilio request signature
function verifyTwilioSignature(url, params, signature) {
  if (!AUTH_TOKEN) {
    console.warn('TWILIO_AUTH_TOKEN not set - skipping verification');
    return true;
  }

  // Build the signature string
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const hash = crypto
    .createHmac('sha1', AUTH_TOKEN)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(hash)
  );
}

// Twilio webhook endpoint
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-twilio-signature'];

  if (!signature) {
    return res.status(401).send('Missing Twilio signature');
  }

  const url = `https://${req.headers.host}${req.url}`;

  if (!verifyTwilioSignature(url, req.body, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const {
    MessageSid,
    From,
    To,
    Body,
    MessageStatus,
    SmsStatus,
    CallSid,
    CallStatus,
    Direction
  } = req.body;

  console.log('Received Twilio webhook');

  // Handle SMS events
  if (MessageSid) {
    console.log('SMS Event:', {
      sid: MessageSid,
      from: From,
      to: To,
      status: MessageStatus || SmsStatus,
      body: Body
    });

    // Respond to incoming SMS with TwiML
    if (Body) {
      return res
        .type('text/xml')
        .send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thanks for your message! You said: ${Body}</Message>
</Response>`);
    }
  }

  // Handle voice call events
  if (CallSid) {
    console.log('Call Event:', {
      sid: CallSid,
      from: From,
      to: To,
      status: CallStatus,
      direction: Direction
    });

    // Respond to incoming call with TwiML
    if (Direction === 'inbound') {
      return res
        .type('text/xml')
        .send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello! Thanks for calling.</Say>
</Response>`);
    }
  }

  res.status(200).send('OK');
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Twilio webhook handler',
    webhook_endpoint: '/webhook'
  });
});

export default app.init();
