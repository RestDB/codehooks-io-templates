import { app, Datastore } from 'codehooks-js';
import crypto from 'crypto';

// Auth bypass for all routes
app.auth('/*', (req, res, next) => next());

// --- Endpoint CRUD ---

// Create new endpoint
app.post('/api/endpoints', async (req, res) => {
  try {
    const name = String(req.body.name || 'Untitled').trim().slice(0, 100);
    const targetUrl = String(req.body.targetUrl || '').trim().slice(0, 2000);
    if (targetUrl && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Target URL must start with http:// or https://' });
    }
    const conn = await Datastore.open();
    const endpoint = {
      uuid: crypto.randomUUID(),
      name,
      targetUrl,
      created: new Date().toISOString()
    };
    const result = await conn.insertOne('endpoints', endpoint);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all endpoints (newest first)
app.get('/api/endpoints', async (req, res) => {
  try {
    const conn = await Datastore.open();
    const endpoints = await conn.getMany('endpoints', {}, { sort: { created: -1 } }).toArray();
    res.json(endpoints);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete endpoint + all its hooks
app.delete('/api/endpoints/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const conn = await Datastore.open();
    const endpoints = await conn.getMany('endpoints', { uuid }).toArray();
    if (endpoints.length === 0) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    await conn.removeOne('endpoints', endpoints[0]._id);
    await conn.removeMany('hooks', { endpointId: uuid });
    res.json({ deleted: true, uuid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Webhook catch route ---

const catchHandler = async (req, res) => {
  try {
    const { uuid } = req.params;
    const conn = await Datastore.open();
    // Verify endpoint exists
    const endpoints = await conn.getMany('endpoints', { uuid }).toArray();
    if (endpoints.length === 0) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    // Store the hook (rawBody for faithful replay, body for display)
    const hook = await conn.insertOne('hooks', {
      endpointId: uuid,
      method: req.method,
      headers: req.headers,
      body: req.body,
      rawBody: req.rawBody || '',
      query: req.query,
      timestamp: new Date().toISOString()
    });
    res.json({ received: true, id: hook._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.get('/hook/:uuid', catchHandler);
app.post('/hook/:uuid', catchHandler);
app.put('/hook/:uuid', catchHandler);
app.patch('/hook/:uuid', catchHandler);
app.delete('/hook/:uuid', catchHandler);

// --- Hook listing and replay ---

// List hooks for endpoint (newest first, limit 100)
app.get('/api/hooks/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const conn = await Datastore.open();
    const hooks = await conn.getMany('hooks', { endpointId: uuid }, { sort: { timestamp: -1 }, limit: 100 }).toArray();
    res.json(hooks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all hooks for an endpoint
app.delete('/api/hooks/:uuid', async (req, res) => {
  try {
    const { uuid } = req.params;
    const conn = await Datastore.open();
    await conn.removeMany('hooks', { endpointId: uuid });
    res.json({ deleted: true, uuid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replay a stored hook
app.post('/api/hooks/:id/replay', async (req, res) => {
  try {
    const { id } = req.params;
    const conn = await Datastore.open();
    const hook = await conn.findOneOrNull('hooks', id);
    if (!hook) {
      return res.status(404).json({ error: 'Hook not found' });
    }
    const endpoints = await conn.getMany('endpoints', { uuid: hook.endpointId }).toArray();
    if (endpoints.length === 0) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    const { targetUrl } = endpoints[0];
    if (!targetUrl) {
      return res.status(400).json({ error: 'No target URL configured for this endpoint' });
    }
    // Forward the hook to targetUrl
    try {
      // Forward original headers, excluding hop-by-hop and internal proxy headers
      const skipHeaders = new Set(['host', 'x-request-id', 'x-real-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-forwarded-scheme', 'x-scheme', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding']);
      const replayHeaders = {};
      if (hook.headers && typeof hook.headers === 'object') {
        for (const [key, value] of Object.entries(hook.headers)) {
          if (!skipHeaders.has(key.toLowerCase())) {
            replayHeaders[key] = value;
          }
        }
      }
      const fetchOptions = {
        method: hook.method,
        headers: replayHeaders
      };
      if (hook.method !== 'GET') {
        // Use rawBody for faithful replay (preserves exact bytes for signature verification)
        fetchOptions.body = hook.rawBody || (typeof hook.body === 'string' ? hook.body : JSON.stringify(hook.body));
      }
      const isCodehooksUrl = targetUrl.includes('.codehooks.io');
      let response;
      if (isCodehooksUrl && typeof app.internalFetch === 'function') {
        response = await app.internalFetch(targetUrl, fetchOptions);
      } else {
        response = await fetch(targetUrl, fetchOptions);
      }
      let responseBody = null;
      try { responseBody = await response.text(); } catch {}
      console.log(`Replay response: ${response.status} ${response.statusText}`, responseBody);
      res.json({ replayed: true, status: response.status, statusText: response.statusText, body: responseBody });
    } catch (fetchErr) {
      console.error(`Replay fetch failed:`, fetchErr.message, fetchErr.cause || '');
      res.status(502).json({ error: 'Failed to replay hook', message: fetchErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Cron cleanup: delete hooks older than 7 days ---

app.job('0 3 * * *', async (_, { jobId }) => {
  const conn = await Datastore.open();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await conn.removeMany('hooks', { timestamp: { $lt: cutoff } });
  console.log(`[Job ${jobId}] Cleaned up hooks older than ${cutoff}`);
});

// --- Static file serving ---

app.static({ route: '/', directory: '/public' });

// Bind to serverless runtime
export default app.init();
