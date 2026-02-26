import { app, Datastore, filestore, openapi } from 'codehooks-js';
import { PassThrough } from 'stream';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import Ajv from 'ajv';
import datamodel from '../datamodel.json' assert { type: 'json' };
import { datamodelSchema } from './datamodel-schema.js';

const JWT_SECRET = process.env.JWT_ACCESS_TOKEN_SECRET;

// ---- Password hashing (using built-in crypto, no external deps) ----
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = createHash('sha256').update(salt + password).digest('hex');
  return candidate === hash;
}

// ---- system_users helpers ----
const PROTECTED_COLLECTIONS = ['system_users', 'datamodel_config', 'datamodel_versions'];

async function findUserByUsername(username) {
  const conn = await Datastore.open();
  const users = await conn.getMany('system_users', { username }, { limit: 1 }).toArray();
  return users.length > 0 ? users[0] : null;
}

// Extract user info directly from JWT (headers set in app.auth may not propagate in codehooks)
function getRequestUser(req) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const token = cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return { username: 'anonymous', role: 'user' };
    const decoded = jwt.verify(token, JWT_SECRET);
    return { username: decoded.username, role: decoded.role };
  } catch {
    return { username: 'anonymous', role: 'user' };
  }
}

function requireAdmin(req, res, next) {
  const { role } = getRequestUser(req);
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Clear token cookie - send both Secure and non-Secure variants
// to ensure stale cookies from either configuration get removed
function clearTokenCookie(res) {
  res.set('Set-Cookie', [
    'token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    'token=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0'
  ]);
}

// ---- 1. Public Endpoints (bypass auth) ----
app.auth('/auth/*', (req, res, next) => next());
app.auth('/api/app', (req, res, next) => next());
app.auth('/docs', (req, res, next) => next());
app.auth('/openapi.json', (req, res, next) => next());

// ---- 2. Auth middleware for /api/* routes ----
app.auth('/api/*', (req, res, next) => {
  // Check for JWT in cookie or Authorization header
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.token || (req.headers.authorization || '').replace('Bearer ', '');

  if (!token) {
    console.log(`AUTH DENIED ${req.method} ${req.originalUrl || req.url} reason=missing_token`);
    clearTokenCookie(res);
    res.status(401).json({ error: 'Missing token' });
    return res.end();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Attach user info to request headers for downstream use
    req.headers['x-user'] = decoded.username;
    req.headers['x-role'] = decoded.role;
    next();
  } catch (err) {
    console.log(`AUTH DENIED ${req.method} ${req.originalUrl || req.url} reason=invalid_token`);
    clearTokenCookie(res);
    res.status(401).json({ error: 'Invalid token' });
    return res.end();
  }
});

// ---- 3. Auth routes ----
app.post('/auth/login',
  openapi({
    summary: 'Login with username and password',
    tags: ['Auth'],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } }, required: ['username', 'password'] } } } },
    responses: { 200: { description: 'Login successful, returns user info and sets auth cookie' }, 401: { description: 'Invalid credentials' } }
  }),
  async (req, res) => {
  const { username, password } = req.body;

  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password)) {
    clearTokenCookie(res);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.active === false) {
    clearTokenCookie(res);
    return res.status(401).json({ error: 'Account is deactivated' });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Set httpOnly cookie
  res.set('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`);
  res.json({ username: user.username, role: user.role });
});

app.get('/auth/me',
  openapi({
    summary: 'Get current authenticated user',
    tags: ['Auth'],
    responses: { 200: { description: 'Current user info' }, 401: { description: 'Not authenticated' } }
  }),
  (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ username: decoded.username, role: decoded.role });
  } catch {
    clearTokenCookie(res);
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/auth/logout',
  openapi({
    summary: 'Logout and clear auth cookie',
    tags: ['Auth'],
    responses: { 200: { description: 'Logged out successfully' } }
  }),
  (req, res) => {
  clearTokenCookie(res);
  res.json({ ok: true });
});

// ---- 4. Datamodel API (DB-backed) ----
async function getDatamodelFromDB() {
  const conn = await Datastore.open();
  const doc = await conn.findOneOrNull('datamodel_config', { type: 'datamodel' });
  if (doc) return doc.data;
  // First run: seed from file
  await conn.insertOne('datamodel_config', { type: 'datamodel', data: datamodel });
  return datamodel;
}

app.get('/api/app',
  openapi({
    summary: 'Get public app settings (title, subtitle)',
    tags: ['Config'],
    responses: { 200: { description: 'App settings object' } }
  }),
  async (req, res) => {
  try {
    const dm = await getDatamodelFromDB();
    res.json(dm.app || { title: 'Admin Panel', subtitle: '' });
  } catch (error) {
    res.json({ title: 'Admin Panel', subtitle: '' });
  }
});

app.get('/api/datamodel',
  openapi({
    summary: 'Get the datamodel configuration',
    tags: ['Config'],
    responses: { 200: { description: 'Datamodel JSON with collection schemas, list fields, and search config' } }
  }),
  async (req, res) => {
  try {
    const dm = await getDatamodelFromDB();
    res.json(dm);
  } catch (error) {
    console.error('Datamodel read error:', error.message);
    res.status(500).json({ error: 'Failed to read datamodel' });
  }
});

app.put('/api/datamodel',
  openapi({
    summary: 'Replace the datamodel configuration (admin only)',
    tags: ['Config'],
    responses: { 200: { description: 'Updated datamodel' }, 403: { description: 'Admin access required' } }
  }),
  requireAdmin,
  async (req, res) => {
  try {
    if (!validateDatamodel(req.body)) {
      return res.status(400).json({ error: 'Invalid datamodel', details: validateDatamodel.errors });
    }
    const savedBy = getRequestUser(req).username;

    const conn = await Datastore.open();
    // Save version snapshot
    await conn.insertOne('datamodel_versions', {
      type: 'datamodel_version',
      data: req.body,
      savedAt: new Date().toISOString(),
      savedBy,
    });
    // Update active datamodel
    const existing = await conn.findOneOrNull('datamodel_config', { type: 'datamodel' });
    if (existing) {
      await conn.replaceOne('datamodel_config', existing._id, { type: 'datamodel', data: req.body });
    } else {
      await conn.insertOne('datamodel_config', { type: 'datamodel', data: req.body });
    }
    res.json(req.body);
  } catch (error) {
    console.error('Datamodel update error:', error.message);
    res.status(500).json({ error: 'Failed to update datamodel' });
  }
});

app.get('/api/datamodel/prompt',
  openapi({
    summary: 'Get an AI prompt for generating or modifying the datamodel (admin only)',
    tags: ['Config'],
    responses: { 200: { description: 'Prompt text for AI assistants' } }
  }),
  requireAdmin,
  async (req, res) => {
  try {
    const dm = await getDatamodelFromDB();
    const includeData = req.query.includeData === 'true';
    const prompt = buildDatamodelPrompt(includeData ? dm : null);
    res.json({ prompt });
  } catch (error) {
    console.error('Prompt generation error:', error.message);
    res.status(500).json({ error: 'Failed to generate prompt' });
  }
});

app.get('/api/datamodel/versions',
  openapi({
    summary: 'List datamodel version history (admin only)',
    tags: ['Config'],
    responses: { 200: { description: 'Array of version metadata (id, date, user)' } }
  }),
  requireAdmin,
  async (req, res) => {
  try {
    const conn = await Datastore.open();
    const versions = await conn.getMany('datamodel_versions', { type: 'datamodel_version' }, {
      sort: { savedAt: -1 },
      limit: 50,
      hints: { $fields: { _id: 1, savedAt: 1, savedBy: 1 } },
    }).toArray();
    res.json(versions);
  } catch (error) {
    console.error('Versions list error:', error.message);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

app.get('/api/datamodel/versions/:id',
  openapi({
    summary: 'Get a specific datamodel version snapshot (admin only)',
    tags: ['Config'],
    responses: { 200: { description: 'Full datamodel snapshot for this version' } }
  }),
  requireAdmin,
  async (req, res) => {
  try {
    const conn = await Datastore.open();
    const doc = await conn.findOne('datamodel_versions', req.params.id);
    res.json(doc);
  } catch (error) {
    console.error('Version fetch error:', error.message);
    res.status(404).json({ error: 'Version not found' });
  }
});

app.get('/api/stats',
  openapi({
    summary: 'Get document counts for all collections',
    tags: ['Config'],
    responses: { 200: { description: 'Object with collection names and their document counts' } }
  }),
  async (req, res) => {
  try {
    const dm = await getDatamodelFromDB();
    const conn = await Datastore.open();
    const stats = {};
    for (const collectionName of Object.keys(dm.collections)) {
      const items = await conn.getMany(collectionName, {}).toArray();
      stats[collectionName] = { count: items.length };
    }
    res.json(stats);
  } catch (error) {
    console.error('Stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ---- 5. JSON Schema Validation ----
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/);
ajv.addFormat('url', /^https?:\/\/.+/);
ajv.addFormat('textarea', true);
ajv.addFormat('file', true);
ajv.addFormat('image', true);

const validateDatamodel = ajv.compile(datamodelSchema);

async function validateBody(collectionName, body, isPartial = false) {
  const dm = await getDatamodelFromDB();
  const config = dm.collections[collectionName];
  if (!config?.schema) return null;

  // Build schema: for PATCH, drop required so partial updates pass
  const schema = isPartial
    ? { ...config.schema, required: undefined }
    : { ...config.schema };

  // additionalProperties false would block _id etc, so allow extras
  schema.additionalProperties = true;

  const valid = ajv.validate(schema, body);
  if (!valid) {
    return ajv.errors.map((err) => ({
      path: err.instancePath.split('/').filter(Boolean),
      message: err.message,
    }));
  }
  return null;
}

// ---- 6. File Upload/Download/Delete (must be before generic CRUD routes) ----
app.post('/api/files/upload', async (req, res) => {
  const user = getRequestUser(req).username;
  const filename = req.query.filename;
  if (!filename) {
    return res.status(400).json({ error: 'Missing filename query parameter' });
  }

  const uniqueId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `/uploads/${uniqueId}_${safeName}`;

  try {
    const stream = new PassThrough();
    req.pipe(stream);
    await filestore.saveFile(storagePath, stream);
    console.log(`FILE UPLOAD user=${user} path=${storagePath}`);
    res.json({ path: storagePath, filename, contentType: getContentType(ext) });
  } catch (error) {
    console.error(`FILE UPLOAD ERROR: ${error.message}`);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/files/download', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'Missing path query parameter' });
  }
  try {
    const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')) : '';
    const contentType = getContentType(ext);
    console.log(`FILE DOWNLOAD path=${filePath} contentType=${contentType}`);
    const buffer = await filestore.readFileAsBuffer(filePath);
    console.log(`FILE DOWNLOAD bufferLength=${buffer.length}`);
    res.set('content-type', contentType);
    res.write(buffer, 'buffer');
    res.end();
  } catch (error) {
    console.error(`FILE DOWNLOAD ERROR: ${error.message}`);
    res.status(404).json({ error: 'File not found' });
  }
});

app.delete('/api/files/delete', async (req, res) => {
  const user = getRequestUser(req).username;
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ error: 'Missing path query parameter' });
  }
  try {
    await filestore.deleteFile(filePath);
    console.log(`FILE DELETE user=${user} path=${filePath}`);
    res.status(204).end();
  } catch (error) {
    console.error(`FILE DELETE ERROR: ${error.message}`);
    res.status(404).json({ error: 'File not found' });
  }
});

// ---- 7. Admin: User Management ----
app.get('/api/admin/users',
  openapi({ summary: 'List all users (admin only)', tags: ['Users'], responses: { 200: { description: 'Array of users' } } }),
  requireAdmin,
  async (req, res) => {
  try {
    const conn = await Datastore.open();
    const users = await conn.getMany('system_users', {}, { sort: { username: 1 } }).toArray();
    res.json(users.map(({ password, ...u }) => u));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/users',
  openapi({ summary: 'Create a user (admin only)', tags: ['Users'], responses: { 200: { description: 'Created user' } } }),
  requireAdmin,
  async (req, res) => {
  try {
    const { username, password, email, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "user" or "admin"' });
    }
    const existing = await findUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const conn = await Datastore.open();
    const hashedPassword = hashPassword(password);
    const doc = await conn.insertOne('system_users', {
      username,
      password: hashedPassword,
      email: email || '',
      role: role || 'user',
      active: true,
      externalId: null,
      authProvider: 'local',
      createdAt: new Date().toISOString(),
    });
    const { password: _, ...userWithoutPassword } = doc;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/users/:id',
  openapi({ summary: 'Update a user (admin only)', tags: ['Users'], responses: { 200: { description: 'Updated user' } } }),
  requireAdmin,
  async (req, res) => {
  try {
    const conn = await Datastore.open();
    const updates = {};
    if (req.body.email !== undefined) updates.email = req.body.email;
    if (req.body.role !== undefined) {
      if (!['user', 'admin'].includes(req.body.role)) {
        return res.status(400).json({ error: 'Role must be "user" or "admin"' });
      }
      updates.role = req.body.role;
    }
    if (req.body.active !== undefined) updates.active = !!req.body.active;
    if (req.body.password) {
      updates.password = hashPassword(req.body.password);
    }
    if (Object.keys(updates).length === 0) {
      const doc = await conn.findOne('system_users', req.params.id);
      const { password, ...u } = doc;
      return res.json(u);
    }
    const doc = await conn.updateOne('system_users', req.params.id, { $set: updates });
    const { password, ...u } = doc;
    res.json(u);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/users/:id',
  openapi({ summary: 'Delete a user (admin only)', tags: ['Users'], responses: { 204: { description: 'User deleted' } } }),
  requireAdmin,
  async (req, res) => {
  try {
    const conn = await Datastore.open();
    const target = await conn.findOne('system_users', req.params.id);
    if (target.username === getRequestUser(req).username) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    await conn.removeOne('system_users', req.params.id);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- 8. Admin: Clear Activity Log ----
app.delete('/api/admin/activitylog',
  openapi({ summary: 'Clear activity log (admin only)', tags: ['Activity'], responses: { 204: { description: 'Activity log cleared' } } }),
  requireAdmin,
  async (req, res) => {
  try {
    const conn = await Datastore.open();
    const all = await conn.getMany('activitylog', {}).toArray();
    for (const item of all) {
      await conn.removeOne('activitylog', item._id);
    }
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- 9. CRUD Handlers ----
async function handleList(collectionName, req, res) {
  if (PROTECTED_COLLECTIONS.includes(collectionName)) {
    return res.status(403).json({ error: 'This collection is not accessible via generic API' });
  }
  const user = getRequestUser(req).username;
  console.log(`GET /api/${collectionName} user=${user} q=${req.query.q || '{}'} h=${req.query.h || '{}'}`);
  try {
    const conn = await Datastore.open();
    const query = req.query.q ? JSON.parse(req.query.q) : {};
    const hints = req.query.h ? JSON.parse(req.query.h) : {};
    const options = {};
    if (hints.$sort) options.sort = hints.$sort;
    if (hints.$limit) options.limit = hints.$limit;
    if (hints.$offset) options.offset = hints.$offset;
    if (hints.$fields) options.hints = { $fields: hints.$fields };
    const items = await conn.getMany(collectionName, query, options).toArray();
    console.log(`GET /api/${collectionName} => ${items.length} items`);
    res.json(items);
  } catch (error) {
    console.error(`GET /api/${collectionName} ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function handleGetOne(collectionName, req, res) {
  if (PROTECTED_COLLECTIONS.includes(collectionName)) {
    return res.status(403).json({ error: 'This collection is not accessible via generic API' });
  }
  const user = getRequestUser(req).username;
  console.log(`GET /api/${collectionName}/${req.params.id} user=${user}`);
  try {
    const conn = await Datastore.open();
    const doc = await conn.findOne(collectionName, req.params.id);
    res.json(doc);
  } catch (error) {
    console.error(`GET /api/${collectionName}/${req.params.id} NOT FOUND`);
    res.status(404).json({ error: 'Document not found' });
  }
}

async function handleCreate(collectionName, req, res) {
  if (PROTECTED_COLLECTIONS.includes(collectionName)) {
    return res.status(403).json({ error: 'This collection is not accessible via generic API' });
  }
  const user = getRequestUser(req).username;
  console.log(`POST /api/${collectionName} user=${user} body=${JSON.stringify(req.body)}`);
  try {
    const errors = await validateBody(collectionName, req.body);
    if (errors) {
      console.log(`POST /api/${collectionName} VALIDATION FAILED: ${JSON.stringify(errors)}`);
      return res.status(400).json(errors);
    }
    const conn = await Datastore.open();
    const doc = await conn.insertOne(collectionName, req.body);
    console.log(`POST /api/${collectionName} => created ${doc._id}`);
    if (collectionName !== 'activitylog') {
      const summary = buildSummary({ user, action: 'created', collection: collectionName, doc });
      logActivity({ user, action: 'created', collection: collectionName, documentId: doc._id, summary, changes: req.body });
    }
    res.json(doc);
  } catch (error) {
    console.error(`POST /api/${collectionName} ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function handleUpdate(collectionName, req, res) {
  if (PROTECTED_COLLECTIONS.includes(collectionName)) {
    return res.status(403).json({ error: 'This collection is not accessible via generic API' });
  }
  const user = getRequestUser(req).username;
  console.log(`PATCH /api/${collectionName}/${req.params.id} user=${user} body=${JSON.stringify(req.body)}`);
  try {
    const errors = await validateBody(collectionName, req.body, true);
    if (errors) {
      console.log(`PATCH /api/${collectionName}/${req.params.id} VALIDATION FAILED: ${JSON.stringify(errors)}`);
      return res.status(400).json(errors);
    }
    const conn = await Datastore.open();
    // Skip $set if body is empty — Codehooks rejects $set: {}
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log(`PATCH /api/${collectionName}/${req.params.id} => no changes`);
      const doc = await conn.findOne(collectionName, req.params.id);
      return res.json(doc);
    }
    const doc = await conn.updateOne(collectionName, req.params.id, { $set: req.body });
    console.log(`PATCH /api/${collectionName}/${req.params.id} => updated`);
    if (collectionName !== 'activitylog') {
      const summary = buildSummary({ user, action: 'updated', collection: collectionName, doc, changes: req.body });
      logActivity({ user, action: 'updated', collection: collectionName, documentId: req.params.id, summary, changes: req.body });
    }
    res.json(doc);
  } catch (error) {
    console.error(`PATCH /api/${collectionName}/${req.params.id} ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function handleDelete(collectionName, req, res) {
  if (PROTECTED_COLLECTIONS.includes(collectionName)) {
    return res.status(403).json({ error: 'This collection is not accessible via generic API' });
  }
  const user = getRequestUser(req).username;
  console.log(`DELETE /api/${collectionName}/${req.params.id} user=${user}`);
  try {
    const conn = await Datastore.open();
    let deletedDoc = {};
    if (collectionName !== 'activitylog') {
      try { deletedDoc = await conn.findOne(collectionName, req.params.id); } catch (e) { /* doc may be gone */ }
    }
    await conn.removeOne(collectionName, req.params.id);
    console.log(`DELETE /api/${collectionName}/${req.params.id} => deleted`);
    if (collectionName !== 'activitylog') {
      const summary = buildSummary({ user, action: 'deleted', collection: collectionName, doc: deletedDoc });
      logActivity({ user, action: 'deleted', collection: collectionName, documentId: req.params.id, summary, changes: deletedDoc });
    }
    res.status(204).end();
  } catch (error) {
    console.error(`DELETE /api/${collectionName}/${req.params.id} ERROR: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// ---- 10. OpenAPI: Build component schemas from datamodel ----
function buildOpenAPISchemas(dm) {
  const schemas = {};
  for (const [name, config] of Object.entries(dm.collections || {})) {
    if (!config.schema?.properties) continue;
    const schemaName = name.charAt(0).toUpperCase() + name.slice(1).replace(/s$/, '');
    const properties = { _id: { type: 'string', description: 'Document ID' } };
    for (const [field, def] of Object.entries(config.schema.properties)) {
      properties[field] = { ...def };
    }
    schemas[schemaName] = {
      type: 'object',
      properties,
      ...(config.schema.required ? { required: config.schema.required } : {}),
    };
  }
  return schemas;
}

// ---- 11. Dynamic OpenAPI specification (reads datamodel from DB) ----
const STATIC_PATHS = {
  '/auth/login': {
    post: { summary: 'Login with username and password', tags: ['Auth'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } }, required: ['username', 'password'] } } } }, responses: { '200': { description: 'Login successful, returns user info and sets auth cookie' }, '401': { description: 'Invalid credentials' } } },
  },
  '/auth/me': {
    get: { summary: 'Get current authenticated user', tags: ['Auth'], responses: { '200': { description: 'Current user info' }, '401': { description: 'Not authenticated' } } },
  },
  '/auth/logout': {
    get: { summary: 'Logout and clear auth cookie', tags: ['Auth'], responses: { '200': { description: 'Logged out successfully' } } },
  },
  '/api/app': {
    get: { summary: 'Get public app settings (title, subtitle)', tags: ['Config'], responses: { '200': { description: 'App settings object' } } },
  },
  '/api/datamodel': {
    get: { summary: 'Get the datamodel configuration', tags: ['Config'], responses: { '200': { description: 'Datamodel JSON with collection schemas, list fields, and search config' } } },
    put: { summary: 'Replace the datamodel configuration (admin only)', tags: ['Config'], responses: { '200': { description: 'Updated datamodel' }, '403': { description: 'Admin access required' } } },
  },
  '/api/datamodel/prompt': {
    get: { summary: 'Get AI prompt for generating or modifying the datamodel (admin only)', tags: ['Config'], responses: { '200': { description: 'Prompt text for AI assistants' } } },
  },
  '/api/datamodel/versions': {
    get: { summary: 'List datamodel version history (admin only)', tags: ['Config'], responses: { '200': { description: 'Array of version metadata (id, date, user)' } } },
  },
  '/api/datamodel/versions/{id}': {
    get: { summary: 'Get a specific datamodel version snapshot (admin only)', tags: ['Config'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Full datamodel snapshot' } } },
  },
  '/api/stats': {
    get: { summary: 'Get document counts for all collections', tags: ['Config'], responses: { '200': { description: 'Object with collection names and their document counts' } } },
  },
  '/api/admin/users': {
    get: { summary: 'List all users (admin only)', tags: ['Users'], responses: { '200': { description: 'Array of users' } } },
    post: { summary: 'Create a user (admin only)', tags: ['Users'], responses: { '200': { description: 'Created user' } } },
  },
  '/api/admin/users/{id}': {
    patch: { summary: 'Update a user (admin only)', tags: ['Users'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated user' } } },
    delete: { summary: 'Delete a user (admin only)', tags: ['Users'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'User deleted' } } },
  },
  '/api/admin/activitylog': {
    delete: { summary: 'Clear activity log (admin only)', tags: ['Activity'], responses: { '204': { description: 'Activity log cleared' } } },
  },
  '/api/files/upload': {
    post: { summary: 'Upload a file', tags: ['Files'], parameters: [{ name: 'filename', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Upload result with file path' } } },
  },
  '/api/files/download': {
    get: { summary: 'Download a file', tags: ['Files'], parameters: [{ name: 'path', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'File content' } } },
  },
  '/api/files/delete': {
    delete: { summary: 'Delete a file', tags: ['Files'], parameters: [{ name: 'path', in: 'query', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'File deleted' } } },
  },
};

function buildOpenAPISpec(dm) {
  const schemas = buildOpenAPISchemas(dm);
  const paths = { ...STATIC_PATHS };

  for (const [collName, collConfig] of Object.entries(dm.collections || {})) {
    if (PROTECTED_COLLECTIONS.includes(collName)) continue;
    const tag = collConfig.label || collName;
    const schemaName = collName.charAt(0).toUpperCase() + collName.slice(1).replace(/s$/, '');
    const schemaRef = { $ref: `#/components/schemas/${schemaName}` };
    const singular = tag.replace(/s$/, '').toLowerCase();

    paths[`/api/${collName}`] = {
      get: {
        summary: `List all ${tag.toLowerCase()}`,
        tags: [tag],
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'JSON query filter, e.g. {"status":"active"}' },
          { name: 'h', in: 'query', schema: { type: 'string' }, description: 'JSON hints: $sort, $limit, $offset, $fields' },
        ],
        responses: { '200': { description: `Array of ${tag.toLowerCase()}`, content: { 'application/json': { schema: { type: 'array', items: schemaRef } } } } },
      },
      post: {
        summary: `Create a ${singular}`,
        tags: [tag],
        requestBody: { required: true, content: { 'application/json': { schema: schemaRef } } },
        responses: { '200': { description: `Created ${singular}`, content: { 'application/json': { schema: schemaRef } } }, '400': { description: 'Validation error' } },
      },
    };

    paths[`/api/${collName}/{id}`] = {
      get: {
        summary: `Get a ${singular} by ID`,
        tags: [tag],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: `A ${singular}`, content: { 'application/json': { schema: schemaRef } } }, '404': { description: 'Not found' } },
      },
      patch: {
        summary: `Update a ${singular}`,
        tags: [tag],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: schemaRef } } },
        responses: { '200': { description: `Updated ${singular}`, content: { 'application/json': { schema: schemaRef } } }, '400': { description: 'Validation error' } },
      },
      delete: {
        summary: `Delete a ${singular}`,
        tags: [tag],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: dm.app?.title ? `${dm.app.title} API` : 'Admin API',
      version: '1.0.0',
      description: 'REST API with full CRUD for all collections. Schemas are auto-generated from the datamodel.',
    },
    paths,
    components: { schemas },
  };
}

app.get('/openapi.json', async (req, res) => {
  try {
    const dm = await getDatamodelFromDB();
    res.json(buildOpenAPISpec(dm));
  } catch (error) {
    console.error('OpenAPI spec error:', error.message);
    res.status(500).json({ error: 'Failed to generate OpenAPI spec' });
  }
});

app.get('/docs', (req, res) => {
  res.set('content-type', 'text/html');
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>body { margin: 0; } .swagger-ui .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: 'openapi.json', dom_id: '#swagger-ui', deepLinking: true });</script>
</body>
</html>`);
});

// ---- 12. Generic CRUD routes (handles all collections including those added at runtime) ----
app.get('/api/:collection', (req, res) => handleList(req.params.collection, req, res));
app.get('/api/:collection/:id', (req, res) => handleGetOne(req.params.collection, req, res));
app.post('/api/:collection', (req, res) => handleCreate(req.params.collection, req, res));
app.patch('/api/:collection/:id', (req, res) => handleUpdate(req.params.collection, req, res));
app.delete('/api/:collection/:id', (req, res) => handleDelete(req.params.collection, req, res));

// ---- SPA Static File Serving (must be AFTER API routes) ----
app.static({
  route: '/',
  directory: '/dist',
  default: 'index.html',
  notFound: '/index.html',
});

export default app.init(async () => {
  // Seed datamodel into DB if not present
  try {
    const conn = await Datastore.open();
    const existing = await conn.findOneOrNull('datamodel_config', { type: 'datamodel' });
    if (!existing) {
      await conn.insertOne('datamodel_config', { type: 'datamodel', data: datamodel });
      console.log('Datamodel seeded into database from file');
    }
  } catch (error) {
    console.error('Datamodel seed error:', error.message);
  }

  // Seed default users if system_users collection is empty
  try {
    const conn = await Datastore.open();
    const anyUser = await conn.getMany('system_users', {}, { limit: 1 }).toArray();
    if (anyUser.length === 0) {
      const defaultUsers = [
        { username: 'admin', password: 'admin', role: 'admin' },
        { username: 'user', password: 'user', role: 'user' },
      ];
      for (const u of defaultUsers) {
        await conn.insertOne('system_users', {
          username: u.username,
          password: hashPassword(u.password),
          email: '',
          role: u.role,
          active: true,
          externalId: null,
          authProvider: 'local',
          createdAt: new Date().toISOString(),
        });
      }
      console.log('Default users seeded: admin/admin (admin), user/user (user)');
    }
  } catch (error) {
    console.error('User seed error:', error.message);
  }
});

// ---- Helpers ----
function parseCookies(cookieStr) {
  const cookies = {};
  cookieStr.split(';').forEach((c) => {
    const [key, ...val] = c.trim().split('=');
    if (key) cookies[key] = val.join('=');
  });
  return cookies;
}

function getContentType(ext) {
  const types = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.zip': 'application/zip',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

// ---- Activity Log ----
async function logActivity({ user, action, collection, documentId, summary, changes }) {
  try {
    const conn = await Datastore.open();
    await conn.insertOne('activitylog', {
      user,
      action,
      collection,
      documentId,
      summary,
      changes,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Activity log write failed:', err.message);
  }
}

function buildSummary({ user, action, collection, doc, changes }) {
  const label = collection.charAt(0).toUpperCase() + collection.slice(1).replace(/s$/, '');
  const displayName = doc?.name || doc?.title || doc?.orderNumber || doc?._id || '';

  if (action === 'updated' && changes) {
    const parts = Object.entries(changes)
      .slice(0, 3)
      .map(([key, val]) => {
        if (val && typeof val === 'object' && val._id) {
          return `${key}: ${val.name || val.title || val._id}`;
        }
        return `${key}: ${val}`;
      });
    return `${user} updated ${label}: ${parts.join(', ')}`;
  }

  if (action === 'created') {
    return `${user} created ${label}: ${displayName}`;
  }

  if (action === 'deleted') {
    return `${user} deleted ${label}: ${displayName}`;
  }

  return `${user} ${action} ${label}: ${displayName}`;
}

function buildDatamodelPrompt(currentDatamodel) {
  const hasCollections = currentDatamodel?.collections && Object.keys(currentDatamodel.collections).length > 0;

  let prompt = `You are generating a datamodel JSON configuration for a master-detail admin application. The JSON you produce must validate against the JSON Schema below.

## JSON Schema (validation rules)

\`\`\`json
${JSON.stringify(datamodelSchema, null, 2)}
\`\`\`

## How to use the schema

The root object has a single key \`collections\`, which is an object where each key is a collection name (lowercase, e.g. "customers", "orders") and each value defines that collection.

### Collection definition

| Key | Required | Description |
|-----|----------|-------------|
| \`label\` | Yes | Display name (e.g. "Customers") |
| \`icon\` | Yes | Lucide icon name (e.g. "users", "package", "shopping-cart", "file-text") |
| \`schema\` | Yes | JSON Schema object — see Field types below |
| \`listFields\` | Yes | Array of field names shown in the list/table view (min 1) |
| \`searchFields\` | Yes | Array of field names to search. Use dot notation for lookup fields (e.g. \`customer.name\`) |
| \`defaultSort\` | No | Sort object, e.g. \`{ "name": 1 }\` (1 = asc, -1 = desc) |
| \`relatedCollections\` | No | Array of related collection configs (see below) |

### Field types (\`schema.properties\`)

Each field needs at minimum \`type\` and \`title\`.

- **string** — Formats: \`email\`, \`url\`, \`date\`, \`date-time\`, \`textarea\`, \`image\`, \`file\`
  - \`enum\`: array of allowed values. \`minLength\`, \`maxLength\`, \`default\`
  - \`image\`/\`file\` format: add \`x-accept\` (e.g. \`.jpg,.png,.pdf\`)
- **number** / **integer** — \`minimum\`, \`maximum\`, \`default\`
- **boolean** — \`default\` (true/false)
- **object** — Lookup/reference to another collection. Add \`x-lookup\`:
  \`\`\`json
  {
    "type": "object",
    "title": "Customer",
    "properties": { "_id": { "type": "string" } },
    "x-lookup": {
      "collection": "customers",
      "displayField": "name",
      "searchFields": ["name", "email"]
    }
  }
  \`\`\`
  - \`displayField\`: string or array of strings — fields shown when displaying the reference
  - \`searchFields\`: fields used for typeahead search. Use dot notation for nested lookups (e.g. \`product.name\`)
- **array** — Format \`file\` for multi-file upload. Needs \`items: { "type": "string" }\`, optional \`x-accept\`
  - Array of lookups (multi-reference): add \`x-lookup\` + \`items: { "type": "object", "properties": { "_id": { "type": "string" } } }\`
  \`\`\`json
  {
    "type": "array",
    "title": "Team Members",
    "items": { "type": "object", "properties": { "_id": { "type": "string" } } },
    "x-lookup": {
      "collection": "employees",
      "displayField": "name",
      "searchFields": ["name", "email"]
    }
  }
  \`\`\`

### Related collections

\`\`\`json
{
  "collection": "orders",
  "foreignKey": "customer._id",
  "title": "Customer Orders",
  "displayFields": ["orderNumber", "total", "status"],
  "allowCreate": true,
  "sort": { "orderDate": -1 },
  "filters": [
    { "field": "status", "value": "pending", "label": "Pending", "active": false },
    { "field": "status", "value": "cancelled", "label": "Exclude Cancelled", "exclude": true }
  ]
}
\`\`\`

- \`foreignKey\`: the field path in the related collection that references this collection (e.g. \`customer._id\`)
- \`filters\`: optional predefined filter buttons. \`exclude: true\` inverts the filter. \`active: false\` means not enabled by default.
`;

  if (hasCollections) {
    prompt += `
## Current datamodel (modify or replace)

\`\`\`json
${JSON.stringify(currentDatamodel, null, 2)}
\`\`\`
`;
  }

  prompt += `
## Instructions

Based on the user's description below, generate${hasCollections ? ' or modify' : ''} the datamodel JSON. Return ONLY valid JSON — no markdown fences, no explanation, just the raw JSON object.

[Describe your datamodel and relations here...]`;

  return prompt;
}
