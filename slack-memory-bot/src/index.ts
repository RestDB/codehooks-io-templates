import { app } from 'codehooks-js';
import { createMemoryAdapter } from './adapters/index';
import { handleAppMention, handleDirectMessage } from './slack/events';
import { handleUrlVerification, verifySlackSignature } from './slack/verification';
import { SlackEventPayload } from './utils/types';

// Initialize memory adapter based on environment config
const memoryAdapter = createMemoryAdapter();

console.log(`Slack Memory Bot started with ${memoryAdapter.getName()}`);

/**
 * Health check endpoint
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    adapter: memoryAdapter.getName(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Main Slack Events API endpoint
 * Handles URL verification and all Slack events
 */
app.post('/slack/events', async (req, res) => {
  try {
    const payload: SlackEventPayload = req.body;

    console.log('Received Slack event:', payload.type);

    // Handle URL verification challenge
    if (payload.type === 'url_verification') {
      if (!payload.challenge) {
        res.status(400).json({ error: 'Missing challenge parameter' });
        return;
      }
      console.log('Handling URL verification challenge');
      const response = handleUrlVerification(payload.challenge);
      res.json(response);
      return;
    }

    // Verify request signature (optional but recommended for production)
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (signingSecret) {
      const signature = req.headers['x-slack-signature'] as string;
      const timestamp = req.headers['x-slack-request-timestamp'] as string;
      const body = req.rawBody;

      if (!signature || !timestamp) {
        res.status(400).json({ error: 'Missing Slack signature headers' });
        return;
      }

      const isValid = verifySlackSignature(
        signingSecret,
        signature,
        timestamp,
        body
      );

      if (!isValid) {
        console.warn('Invalid Slack signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Handle event callbacks
    if (payload.type === 'event_callback' && payload.event) {
      const event = payload.event;

      console.log('Event details:', {
        type: event.type,
        channel_type: event.channel_type,
        has_bot_id: !!event.bot_id,
        user: event.user,
        text: event.text?.substring(0, 50)
      });

      // Ignore bot messages to prevent loops
      if (event.bot_id) {
        console.log('Ignoring bot message');
        res.status(200).send('ok');
        return;
      }

      // Handle app mentions (when bot is @mentioned)
      if (event.type === 'app_mention') {
        // Respond immediately to Slack (required within 3 seconds)
        res.status(200).send('ok');

        // Process the event asynchronously
        handleAppMention(event, memoryAdapter).catch((error) => {
          console.error('Error handling app_mention:', error);
        });
        return;
      }

      // Handle direct messages
      if (event.type === 'message' && event.channel_type === 'im') {
        // Respond immediately to Slack
        res.status(200).send('ok');

        // Process the event asynchronously
        handleDirectMessage(event, memoryAdapter).catch((error) => {
          console.error('Error handling direct message:', error);
        });
        return;
      }

      console.log(`Unhandled event type: ${event.type}`);
      res.status(200).send('ok');
      return;
    }

    // Unknown payload type
    console.warn('Unknown Slack payload type:', payload.type);
    res.status(200).send('ok');
  } catch (error) {
    console.error('Error processing Slack event:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * Allow public access to Slack webhook endpoint
 * No authentication required since Slack signature verification is used
 */
app.auth('/slack/*', (_req, _res, next) => {
  next(); // Allow public access
});

/**
 * Allow public access to health check
 */
app.auth('/health', (_req, _res, next) => {
  next(); // Allow public access
});

// Export the app for serverless deployment
export default app.init();
