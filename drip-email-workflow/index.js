import { app, Datastore } from 'codehooks-js';
import https from 'https';
import FormData from 'form-data';
import fetch from 'node-fetch';
import workflowConfig from './stepsconfig.json' assert { type: 'json' };
import { generateEmailTemplate } from './email-template.js';

// Log loaded configuration
console.log(`✅ Loaded workflow configuration: ${workflowConfig.workflowSteps.length} steps`);

// Database connection helper
const getDB = async () => {
  return await Datastore.open();
};

// Email provider configuration
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'sendgrid'; // 'sendgrid', 'mailgun', or 'postmark'
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const POSTMARK_API_KEY = process.env.POSTMARK_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@example.com';
const FROM_NAME = process.env.FROM_NAME || 'Drip Campaign';

// Dry run mode - checked at runtime, can be toggled without redeploying

/**
 * Get workflow steps from stepsconfig.json
 * Each step defines when it should be sent (hours after signup) and the email template
 */
function getWorkflowSteps() {
  return workflowConfig.workflowSteps;
}

/**
 * Get rate limit for current email provider
 */
function getRateLimit() {
  const provider = process.env.EMAIL_PROVIDER || 'sendgrid';
  const limits = {
    sendgrid: parseInt(process.env.SENDGRID_RATE_LIMIT || '100'),
    mailgun: parseInt(process.env.MAILGUN_RATE_LIMIT || '100'),
    postmark: parseInt(process.env.POSTMARK_RATE_LIMIT || '100')
  };
  return limits[provider] || parseInt(process.env.EMAIL_RATE_LIMIT || '100');
}

/**
 * Get max emails to queue per cron run
 */
function getMaxEmailsPerRun() {
  return parseInt(process.env.MAX_EMAILS_PER_CRON_RUN || '25');
}

/**
 * Increment rate tracker for current hour
 */
async function incrementRateTracker(conn) {
  const now = new Date();
  const currentHour = now.toISOString().substring(0, 13) + ":00:00.000Z";
  const hourKey = `rate_tracker_${currentHour.replace(/[:-]/g, '_').substring(0, 19)}`;

  await conn.updateOne(
    'email_rate_tracking',
    { _id: hourKey },
    {
      $inc: { sentCount: 1 },
      $set: {
        updatedAt: new Date().toISOString(),
        provider: EMAIL_PROVIDER
      }
    },
    { upsert: true }
  );
}

/**
 * Send email via SendGrid REST API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML email content
 * @returns {Promise<boolean>} - Success status
 */
async function sendEmailSendGrid(to, subject, html) {
  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: subject,
    content: [{ type: 'text/html', value: html }]
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.sendgrid.com',
      port: 443,
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          console.error(`❌ SendGrid rate limit: ${res.statusCode} - ${data}`);
          reject(new Error(`429 - Rate limit exceeded: ${data}`));
        } else if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ SendGrid email sent to ${to}`);
          resolve(true);
        } else {
          console.error(`❌ SendGrid error: ${res.statusCode} - ${data}`);
          reject(new Error(`SendGrid API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('SendGrid request error:', error);
      reject(error);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send email via Mailgun REST API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML email content
 * @returns {Promise<boolean>} - Success status
 */
async function sendEmailMailgun(to, subject, html) {
  return new Promise(async (resolve, reject) => {
    try {
      // Validate required configuration
      if (!MAILGUN_API_KEY || MAILGUN_API_KEY.trim() === '') {
        throw new Error('MAILGUN_API_KEY environment variable is not set');
      }
      if (!MAILGUN_DOMAIN || MAILGUN_DOMAIN.trim() === '') {
        throw new Error('MAILGUN_DOMAIN environment variable is not set');
      }

      console.log('📧 [Mailgun] Sending email to', to);

      // Create form data for Mailgun
      const form = new FormData();
      form.append('from', `${FROM_NAME} <${FROM_EMAIL}>`);
      form.append('to', to);
      form.append('subject', subject);
      form.append('html', html);

      // Support EU region
      const hostname = process.env.MAILGUN_EU === 'true' ? 'api.eu.mailgun.net' : 'api.mailgun.net';

      // Mailgun URL with embedded API key
      const url = `https://api:${MAILGUN_API_KEY}@${hostname}/v3/${MAILGUN_DOMAIN}/messages`;

      // Basic auth credentials (base64 encoded)
      const credentials = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');

      console.log(`🔍 [Mailgun Debug] Domain: ${MAILGUN_DOMAIN}`);
      console.log(`🔍 [Mailgun Debug] Hostname: ${hostname}`);
      console.log(`🔍 [Mailgun Debug] From: ${FROM_NAME} <${FROM_EMAIL}>`);

      // Send request using node-fetch
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`
        },
        body: form
      });

      // Handle response
      if (resp.status === 429) {
        const errorText = await resp.text();
        console.error(`❌ Mailgun rate limit: ${resp.status} - ${errorText}`);
        reject(new Error(`429 - Rate limit exceeded: ${errorText}`));
      } else if (resp.status <= 201) {
        const output = await resp.json();
        console.log(`✅ Mailgun email sent to ${to}`, output);
        resolve(true);
      } else {
        const errorText = await resp.text();
        console.error(`❌ Mailgun error: ${resp.status} ${resp.statusText}`);
        console.error(`   Response: ${errorText}`);
        reject(new Error(`Mailgun API error: ${resp.status} - ${errorText}`));
      }
    } catch (error) {
      console.error('❌ Mailgun request error:', error);
      reject(error);
    }
  });
}

/**
 * Send email via Postmark REST API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML email content
 * @returns {Promise<boolean>} - Success status
 */
async function sendEmailPostmark(to, subject, html) {
  try {
    // Validate required configuration
    if (!POSTMARK_API_KEY || POSTMARK_API_KEY.trim() === '') {
      throw new Error('POSTMARK_API_KEY environment variable is not set');
    }

    console.log('📧 [Postmark] Sending email to', to);

    // Generate plain text version from HTML
    const text = html.replace(/<[^>]*>/g, '').replace(/\n\n+/g, '\n\n').trim();

    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: `${FROM_NAME} <${FROM_EMAIL}>`,
        To: to,
        Subject: subject,
        TextBody: text,
        HtmlBody: html
      })
    });

    if (response.status === 429) {
      const error = await response.json();
      console.error(`❌ Postmark rate limit: ${response.status} - ${JSON.stringify(error)}`);
      throw new Error(`429 - Rate limit exceeded: ${JSON.stringify(error)}`);
    } else if (response.ok) {
      const result = await response.json();
      console.log(`✅ Postmark email sent to ${to}`, result);
      return true;
    } else {
      const error = await response.json();
      console.error(`❌ Postmark error: ${response.status} ${response.statusText}`);
      console.error(`   Response:`, error);
      throw new Error(`Postmark API error: ${response.status} - ${JSON.stringify(error)}`);
    }
  } catch (error) {
    console.error('❌ Postmark request error:', error);
    throw error;
  }
}

/**
 * Send email using configured provider
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML email content
 * @returns {Promise<boolean>} - Success status
 */
async function sendEmail(to, subject, html) {
  // Dry run mode - check at runtime for flexibility
  const isDryRun = process.env.DRY_RUN === 'true';

  if (isDryRun) {
    console.log('📧 [DRY RUN] Would send email:');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   HTML length: ${html.length} characters`);
    console.log(`   Provider: ${EMAIL_PROVIDER}`);
    console.log(`   From: ${FROM_NAME} <${FROM_EMAIL}>`);
    return true; // Simulate success
  }

  // Normal mode - actually send email
  if (EMAIL_PROVIDER === 'mailgun') {
    return await sendEmailMailgun(to, subject, html);
  } else if (EMAIL_PROVIDER === 'postmark') {
    return await sendEmailPostmark(to, subject, html);
  } else {
    return await sendEmailSendGrid(to, subject, html);
  }
}

/**
 * Generate HTML email from template
 * @param {object} template - Email template configuration
 * @param {object} subscriber - Subscriber information
 * @returns {string} - HTML email content
 */
function generateEmailHTML(template, subscriber) {
  const { subject, heading, body, buttonText, buttonUrl, logoUrl } = template;

  // Replace placeholders in content
  const personalizedHeading = heading
    .replace(/\{\{name\}\}/g, subscriber.name || 'there')
    .replace(/\{\{email\}\}/g, subscriber.email);

  const personalizedBody = body
    .replace(/\{\{name\}\}/g, subscriber.name || 'there')
    .replace(/\{\{email\}\}/g, subscriber.email);

  // Use the imported template generator
  return generateEmailTemplate({
    subject,
    heading: personalizedHeading,
    body: personalizedBody,
    buttonText,
    buttonUrl,
    logoUrl,
    fromName: FROM_NAME
  });
}

/**
 * Get email template for a specific step
 * First checks database for custom template, then falls back to stepsconfig.json template
 */
async function getTemplate(step) {
  const conn = await getDB();
  let templates = [];

  try {
    templates = await conn.getMany('templates', { step }).toArray();
  } catch (err) {
    templates = [];
  }

  // If custom template exists in database, use it
  if (templates.length > 0) {
    return templates[0];
  }

  // Otherwise, get template from stepsconfig.json
  const steps = getWorkflowSteps();
  const stepConfig = steps.find(s => s.step === step);

  if (stepConfig && stepConfig.template) {
    return {
      step: stepConfig.step,
      ...stepConfig.template
    };
  }

  // Final fallback (should rarely happen)
  return {
    step,
    subject: `Email ${step}`,
    heading: `Hello, {{name}}!`,
    body: `This is email ${step} in your drip campaign.`,
    buttonText: '',
    buttonUrl: '',
    logoUrl: ''
  };
}

// Health check endpoint
app.get('/', (req, res) => {
  const steps = getWorkflowSteps();
  res.json({
    status: 'ok',
    service: 'Drip Email Workflow System',
    version: '4.1.0',
    features: [
      'Dynamic step configuration',
      'Single cron job for all steps',
      'Queue-based email delivery',
      'SendGrid, Mailgun, and Postmark integration',
      'Subscriber management with subscribe/unsubscribe',
      'Customizable email templates',
      'Prevents duplicate email sends',
      'Streaming architecture for scalability',
      'Email audit log with dry-run tracking'
    ],
    configuration: {
      emailProvider: EMAIL_PROVIDER,
      dryRun: process.env.DRY_RUN === 'true',
      workflowSteps: steps.map(s => ({
        step: s.step,
        hoursAfterSignup: s.hoursAfterSignup,
        description: `Step ${s.step}: ${s.hoursAfterSignup} hours after signup`
      }))
    },
    endpoints: {
      health: '/',
      subscribers: '/subscribers',
      unsubscribe: '/subscribers/:id/unsubscribe (requires x-apikey)',
      templates: '/templates',
      emailLog: '/email-log',
      emailLogStats: '/email-log/stats',
      rateLimitStatus: '/rate-limit-status'
    },
    rateLimiting: {
      enabled: true,
      rateLimit: getRateLimit(),
      maxPerCronRun: getMaxEmailsPerRun()
    }
  });
});

// ==================== SUBSCRIBER MANAGEMENT ====================

/**
 * Create a new subscriber
 * POST /subscribers
 * Body: { name, email }
 */
app.post('/subscribers', async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    const conn = await getDB();

    // Check if subscriber already exists
    let existingSubscriber = null;
    try {
      existingSubscriber = await conn.getOne('subscribers', { email });
    } catch (err) {
      existingSubscriber = null;
    }

    if (existingSubscriber) {
      return res.status(400).json({
        error: 'Subscriber already exists',
        subscriberId: existingSubscriber._id
      });
    }

    const subscriber = {
      name: name || '',
      email,
      subscribed: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      emailsSent: [] // Array of step numbers that have been sent
    };

    const result = await conn.insertOne('subscribers', subscriber);

    console.log(`✅ New subscriber added: ${email}`);

    res.status(201).json({
      id: result._id,
      name: subscriber.name,
      email: subscriber.email,
      subscribed: subscriber.subscribed,
      message: 'Subscriber created successfully. Emails will be sent automatically.'
    });
  } catch (error) {
    console.error('Error creating subscriber:', error);
    res.status(500).json({ error: 'Failed to create subscriber' });
  }
});

/**
 * Get all subscribers
 * GET /subscribers?subscribed=true|false
 */
app.get('/subscribers', async (req, res) => {
  try {
    const { subscribed } = req.query;
    const conn = await getDB();

    let query = {};
    if (subscribed !== undefined) {
      query.subscribed = subscribed === 'true' || subscribed === true;
    }

    const subscribers = await conn.getMany('subscribers', query).toArray();

    res.json({
      subscribers: subscribers.map(s => ({
        id: s._id,
        name: s.name,
        email: s.email,
        subscribed: s.subscribed,
        emailsSent: s.emailsSent,
        createdAt: s.createdAt
      })),
      count: subscribers.length
    });
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
});

/**
 * Get a specific subscriber
 * GET /subscribers/:id
 */
app.get('/subscribers/:id', async (req, res) => {
  try {
    const conn = await getDB();
    const subscriber = await conn.getOne('subscribers', { _id: req.params.id });

    if (!subscriber) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    res.json(subscriber);
  } catch (error) {
    console.error('Error fetching subscriber:', error);
    res.status(500).json({ error: 'Failed to fetch subscriber' });
  }
});

/**
 * Unsubscribe a subscriber (secured with API token)
 * POST /subscribers/:id/unsubscribe
 * Headers: x-apikey: YOUR_API_KEY
 */
app.post('/subscribers/:id/unsubscribe', async (req, res) => {
  try {
    const conn = await getDB();
    const subscriber = await conn.getOne('subscribers', { _id: req.params.id });

    if (!subscriber) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }

    await conn.updateOne(
      'subscribers',
      { _id: req.params.id },
      {
        $set: {
          subscribed: false,
          updatedAt: new Date().toISOString()
        }
      }
    );

    console.log(`🚫 Subscriber unsubscribed: ${subscriber.email}`);

    res.json({
      message: 'Subscriber unsubscribed successfully',
      id: req.params.id,
      email: subscriber.email
    });
  } catch (error) {
    console.error('Error unsubscribing subscriber:', error);
    res.status(500).json({ error: 'Failed to unsubscribe subscriber' });
  }
});

// ==================== EMAIL TEMPLATE MANAGEMENT ====================

/**
 * Get all email templates
 * GET /templates
 * Returns templates from stepsconfig.json, with database overrides if they exist
 */
app.get('/templates', async (req, res) => {
  try {
    const conn = await getDB();
    const steps = getWorkflowSteps();

    // Get any custom templates from database
    let dbTemplates = [];
    try {
      dbTemplates = await conn.getMany('templates', {}).toArray();
    } catch (err) {
      dbTemplates = [];
    }

    // Build template list: use DB template if exists, otherwise use config template
    const templates = steps.map(stepConfig => {
      const dbTemplate = dbTemplates.find(t => t.step === stepConfig.step);
      if (dbTemplate) {
        return dbTemplate;
      }
      // Return config template
      return {
        step: stepConfig.step,
        ...stepConfig.template,
        source: 'stepsconfig.json'
      };
    });

    res.json({
      templates,
      count: templates.length,
      note: 'Templates from stepsconfig.json can be overridden by creating custom templates via POST /templates'
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

/**
 * Create or update an email template
 * POST /templates
 * Body: { step, subject, heading, body, buttonText, buttonUrl, logoUrl }
 */
app.post('/templates', async (req, res) => {
  try {
    const { step, subject, heading, body, buttonText, buttonUrl, logoUrl } = req.body;
    const steps = getWorkflowSteps();

    if (!step || step < 1 || step > steps.length) {
      return res.status(400).json({
        error: `Step must be between 1 and ${steps.length}`
      });
    }

    if (!subject || !heading || !body) {
      return res.status(400).json({ error: 'Subject, heading, and body are required' });
    }

    const conn = await getDB();

    // Check if template for this step already exists
    let existingTemplate = null;
    try {
      existingTemplate = await conn.getOne('templates', { step });
    } catch (err) {
      existingTemplate = null;
    }

    const templateData = {
      step,
      subject,
      heading,
      body,
      buttonText: buttonText || '',
      buttonUrl: buttonUrl || '',
      logoUrl: logoUrl || '',
      updatedAt: new Date().toISOString()
    };

    if (existingTemplate) {
      await conn.updateOne('templates', { step }, { $set: templateData });
      res.json({ message: 'Template updated', step });
    } else {
      templateData.createdAt = new Date().toISOString();
      const result = await conn.insertOne('templates', templateData);
      res.status(201).json({ message: 'Template created', id: result._id, step });
    }
  } catch (error) {
    console.error('Error creating/updating template:', error);
    res.status(500).json({ error: 'Failed to create/update template' });
  }
});

// ==================== EMAIL LOG API ====================

/**
 * Get email send logs
 * GET /email-log?subscriberId=xxx&step=1&success=true&dryRun=false
 */
app.get('/email-log', async (req, res) => {
  try {
    const { subscriberId, step, success, dryRun, limit } = req.query;
    const conn = await getDB();

    // Build query
    const query = {};
    if (subscriberId) query.subscriberId = subscriberId;
    if (step) query.step = parseInt(step);
    if (success !== undefined) query.success = success === 'true';
    if (dryRun !== undefined) query.dryRun = dryRun === 'true';

    // Get logs with optional limit (default 100, max 1000)
    const maxLimit = Math.min(parseInt(limit) || 100, 1000);

    const cursor = conn.getMany('email_log', query)
      .sort({ sentAt: -1 })
      .limit(maxLimit);

    const logs = await cursor.toArray();

    res.json({
      logs,
      count: logs.length,
      query
    });
  } catch (error) {
    console.error('Error fetching email logs:', error);
    res.status(500).json({ error: 'Failed to fetch email logs' });
  }
});

/**
 * Get email log statistics
 * GET /email-log/stats
 */
app.get('/email-log/stats', async (_req, res) => {
  try {
    const conn = await getDB();

    // Get all logs (for stats, we need to analyze them)
    const allLogs = await conn.getMany('email_log', {}).toArray();

    const stats = {
      total: allLogs.length,
      successful: allLogs.filter(log => log.success).length,
      failed: allLogs.filter(log => !log.success).length,
      dryRun: allLogs.filter(log => log.dryRun).length,
      byStep: {},
      byProvider: {},
      recentErrors: allLogs
        .filter(log => !log.success)
        .slice(0, 10)
        .map(log => ({
          email: log.email,
          step: log.step,
          error: log.error,
          sentAt: log.sentAt
        }))
    };

    // Count by step
    allLogs.forEach(log => {
      stats.byStep[log.step] = (stats.byStep[log.step] || 0) + 1;
    });

    // Count by provider
    allLogs.forEach(log => {
      if (log.provider) {
        stats.byProvider[log.provider] = (stats.byProvider[log.provider] || 0) + 1;
      }
    });

    res.json(stats);
  } catch (error) {
    console.error('Error fetching email log stats:', error);
    res.status(500).json({ error: 'Failed to fetch email log stats' });
  }
});

// ==================== DYNAMIC CRON JOB (SINGLE JOB FOR ALL STEPS) ====================

/**
 * Single Cron Job: Process ALL workflow steps dynamically
 * Runs every 15 minutes to check all subscribers against all configured steps
 * Determines which subscribers are ready for which step and queues them
 */
app.job('*/15 * * * *', async (req, res) => {
  try {
    console.log('🔄 [Cron] Starting drip email batch processing...');

    const conn = await getDB();
    const workflowSteps = getWorkflowSteps();
    const now = Date.now();

    // Get rate limit configuration
    const rateLimit = getRateLimit();
    const maxPerRun = getMaxEmailsPerRun();

    // Check current hour's send count
    const currentHour = new Date(now).toISOString().substring(0, 13) + ":00:00.000Z";
    const hourKey = `rate_tracker_${currentHour.replace(/[:-]/g, '_').substring(0, 19)}`;

    let rateTracker;
    try {
      rateTracker = await conn.getOne('email_rate_tracking', { _id: hourKey });
    } catch (err) {
      rateTracker = null;
    }

    if (!rateTracker) {
      rateTracker = {
        _id: hourKey,
        provider: EMAIL_PROVIDER,
        hour: currentHour,
        sentCount: 0,
        createdAt: new Date().toISOString()
      };
      await conn.insertOne('email_rate_tracking', rateTracker);
    }

    // Calculate remaining capacity
    const remainingInHour = rateLimit - rateTracker.sentCount;
    const maxToQueue = Math.min(maxPerRun, remainingInHour);

    if (maxToQueue <= 0) {
      console.log(`⚠️ [Cron] Rate limit reached: ${rateTracker.sentCount}/${rateLimit} sent this hour. Skipping queue.`);
      return res.end();
    }

    console.log(`📊 [Cron] Rate limit: ${rateTracker.sentCount}/${rateLimit} sent this hour, queueing up to ${maxToQueue} emails`);

    let totalQueued = 0;
    let totalChecked = 0;

    // For each workflow step, stream subscribers who need that email
    for (const stepConfig of workflowSteps) {
      if (totalQueued >= maxToQueue) {
        console.log(`⚠️ [Cron] Reached max queue limit (${maxToQueue}), stopping`);
        break;
      }

      const { step, hoursAfterSignup } = stepConfig;
      const cutoffTime = new Date(now - hoursAfterSignup * 60 * 60 * 1000).toISOString();

      let stepQueued = 0;
      let stepChecked = 0;

      // Stream subscribers ready for this step
      const cursor = conn.getMany('subscribers', {
        subscribed: true,
        createdAt: { $lte: cutoffTime }
      });

      // Use streaming architecture to process subscribers one at a time
      await cursor.forEach(async (subscriber) => {
        if (totalQueued >= maxToQueue) return;

        stepChecked++;

        // Check if subscriber hasn't received this step yet
        const hasNotReceivedStep = !subscriber.emailsSent || !subscriber.emailsSent.includes(step);

        if (hasNotReceivedStep) {
          // Atomically mark this step as sent before queueing
          try {
            const updateResult = await conn.updateOne(
              'subscribers',
              {
                _id: subscriber._id,
                emailsSent: { $nin: [step] }
              },
              {
                $push: { emailsSent: step },
                $set: { updatedAt: new Date().toISOString() }
              }
            );

            // Only queue if we successfully updated
            if (updateResult) {
              await conn.enqueue('send-email', {
                subscriberId: subscriber._id,
                email: subscriber.email,
                name: subscriber.name,
                step: step
              });
              stepQueued++;
              totalQueued++;
            }
          } catch (error) {
            console.error(`⚠️ [Cron] Failed to update subscriber ${subscriber._id} for step ${step}:`, error);
          }
        }
      });

      totalChecked += stepChecked;

      if (stepQueued > 0) {
        console.log(`✅ [Cron] Step ${step}: Checked ${stepChecked} subscribers, queued ${stepQueued} emails (${hoursAfterSignup}h after signup)`);
      } else if (stepChecked > 0) {
        console.log(`🔄 [Cron] Step ${step}: Checked ${stepChecked} subscribers, already sent to all`);
      }
    }

    console.log(`🔄 [Cron] Total: ${totalChecked} subscriber-step combinations checked`);

    if (totalQueued === 0) {
      console.log('🔄 [Cron] No emails to queue at this time');
    } else {
      console.log(`✅ [Cron] Batch complete: Queued ${totalQueued}/${maxToQueue} emails`);
    }

    res.end();
  } catch (error) {
    console.error('❌ [Cron] Error:', error);
    res.status(500).end();
  }
});

// ==================== QUEUE WORKER ====================

/**
 * Worker: Send email from queue
 * Processes queued email jobs and sends emails
 */
app.worker('send-email', async (req, res) => {
  const conn = await getDB();
  const { payload } = req.body;
  const { subscriberId, email, name, step, retryCount = 0 } = payload;

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000]; // 5min, 15min, 30min

  try {
    console.log(`📨 [Worker] Processing email for ${email}, step ${step}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`);

    // Check subscriber is still subscribed
    const subscriber = await conn.getOne('subscribers', { _id: subscriberId });

    if (!subscriber || !subscriber.subscribed) {
      console.log(`⚠️ [Worker] Subscriber ${subscriberId} not found or unsubscribed, skipping`);
      return res.end();
    }

    // Verify step is marked as sent (should be, since cron job marks it)
    if (!subscriber.emailsSent || !subscriber.emailsSent.includes(step)) {
      console.log(`⚠️ [Worker] Step ${step} not marked as sent for ${email}, unexpected state`);
      return res.end();
    }

    // Get template and generate email
    const template = await getTemplate(step);
    const html = generateEmailHTML(template, { email, name });

    // Send email
    const emailSent = await sendEmail(email, template.subject, html);

    // Increment rate tracker on success
    await incrementRateTracker(conn);

    // Log email send to audit collection
    await conn.insertOne('email_log', {
      subscriberId,
      email,
      name,
      step,
      subject: template.subject,
      sentAt: new Date().toISOString(),
      dryRun: process.env.DRY_RUN === 'true',
      success: true,
      provider: EMAIL_PROVIDER,
      retryCount
    });

    console.log(`✅ [Worker] Step ${step} email sent to ${email}`);
    res.end();
  } catch (error) {
    console.error('❌ [Worker] Error sending email:', error);

    // Check if it's a rate limit error (429)
    const isRateLimitError = error.message?.includes('429') ||
                            error.message?.includes('rate limit') ||
                            error.message?.includes('Rate limit') ||
                            error.message?.includes('Too Many Requests');

    if (isRateLimitError && retryCount < MAX_RETRIES) {
      // Don't remove from emailsSent - keep it marked
      const retryDelay = RETRY_DELAYS[retryCount];

      console.log(`⏰ [Worker] Rate limit hit, retrying ${email} in ${retryDelay/1000/60} minutes (attempt ${retryCount + 1}/${MAX_RETRIES})`);

      // Re-queue with delay
      setTimeout(async () => {
        try {
          await conn.enqueue('send-email', {
            subscriberId,
            email,
            name,
            step,
            retryCount: retryCount + 1
          });
        } catch (enqueueError) {
          console.error('❌ [Worker] Failed to re-queue email:', enqueueError);
        }
      }, retryDelay);

      // Log retry attempt
      try {
        const template = await getTemplate(step);
        await conn.insertOne('email_log', {
          subscriberId,
          email,
          name,
          step,
          subject: template?.subject || `Step ${step}`,
          sentAt: new Date().toISOString(),
          dryRun: process.env.DRY_RUN === 'true',
          success: false,
          provider: EMAIL_PROVIDER,
          error: `Rate limit - will retry in ${retryDelay/1000/60} min`,
          retryCount,
          willRetry: true
        });
      } catch (logError) {
        console.error('❌ [Worker] Failed to log retry:', logError);
      }

      return res.end();
    }

    // For non-rate-limit errors or max retries exceeded, remove from emailsSent
    try {
      await conn.updateOne(
        'subscribers',
        { _id: subscriberId },
        {
          $pull: { emailsSent: step },
          $set: { updatedAt: new Date().toISOString() }
        }
      );
      console.log(`🔄 [Worker] Removed step ${step} from ${email} for retry by cron`);
    } catch (updateError) {
      console.error('❌ [Worker] Failed to reset subscriber state:', updateError);
    }

    // Log failure
    try {
      const template = await getTemplate(step);
      await conn.insertOne('email_log', {
        subscriberId,
        email,
        name,
        step,
        subject: template?.subject || `Step ${step}`,
        sentAt: new Date().toISOString(),
        dryRun: process.env.DRY_RUN === 'true',
        success: false,
        provider: EMAIL_PROVIDER,
        error: error.message,
        retryCount,
        willRetry: false
      });
    } catch (logError) {
      console.error('❌ [Worker] Failed to log error:', logError);
    }

    // Workers always return with res.end()
    res.end();
  }
});

// ==================== RATE LIMITING MONITORING ====================

/**
 * Get current rate limit status
 * GET /rate-limit-status
 */
app.get('/rate-limit-status', async (req, res) => {
  try {
    const conn = await getDB();
    const now = new Date();
    const currentHour = now.toISOString().substring(0, 13) + ":00:00.000Z";
    const hourKey = `rate_tracker_${currentHour.replace(/[:-]/g, '_').substring(0, 19)}`;

    let rateTracker;
    try {
      rateTracker = await conn.getOne('email_rate_tracking', { _id: hourKey });
    } catch (err) {
      rateTracker = null;
    }

    const rateLimit = getRateLimit();
    const sentThisHour = rateTracker?.sentCount || 0;

    res.json({
      provider: EMAIL_PROVIDER,
      rateLimit,
      currentHour,
      sentThisHour,
      remaining: Math.max(0, rateLimit - sentThisHour),
      percentUsed: Math.round((sentThisHour / rateLimit) * 100),
      status: sentThisHour >= rateLimit ? 'rate_limit_reached' : 'ok'
    });
  } catch (error) {
    console.error('Error fetching rate limit status:', error);
    res.status(500).json({ error: 'Failed to fetch rate limit status' });
  }
});

// ==================== CLEANUP JOB ====================

/**
 * Daily cleanup job: Remove old rate tracking records
 * Runs daily at 2 AM
 */
app.job('0 2 * * *', async (req, res) => {
  try {
    const conn = await getDB();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const result = await conn.removeMany('email_rate_tracking', {
      createdAt: { $lt: twoDaysAgo }
    });

    console.log(`🧹 [Cleanup] Removed ${result?.deletedCount || 0} old rate tracking records`);
    res.end();
  } catch (error) {
    console.error('❌ [Cleanup] Error:', error);
    res.status(500).end();
  }
});

// Export the app
export default app.init();
