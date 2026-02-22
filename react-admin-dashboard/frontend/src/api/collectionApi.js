import { toast } from 'sonner';

const BASE_URL = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const headers = { ...options.headers };
  // Only set Content-Type for requests that send a body
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers,
    });
  } catch (err) {
    const networkError = new Error('Network error — check your connection');
    networkError.isNetwork = true;
    toast.error('Network error', { description: 'Could not reach the server. Check your connection.' });
    throw networkError;
  }

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (res.status === 403) {
    const forbiddenError = new Error('You do not have permission to perform this action');
    forbiddenError.isForbidden = true;
    toast.error('Access denied', { description: 'This action requires admin privileges.' });
    throw forbiddenError;
  }

  if (res.status === 429) {
    const rateLimitError = new Error('Rate limit exceeded — a paid plan may be required');
    rateLimitError.isRateLimit = true;
    toast.error('Rate limit exceeded', {
      description: 'Too many requests. A paid Codehooks plan may be required.',
      duration: 8000,
    });
    throw rateLimitError;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let err = {};
    try { err = JSON.parse(text); } catch { /* not JSON */ }
    // Crudlify returns validation errors as an array with path + message per field
    if (Array.isArray(err)) {
      const validationError = new Error('Validation failed');
      validationError.fieldErrors = {};
      for (const e of err) {
        const field = e.path?.[0] || '_general';
        validationError.fieldErrors[field] = e.message;
      }
      throw validationError;
    }
    throw new Error(err.error || err.message || `API error: ${res.status}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Fetch documents from a collection with search, sort, and pagination.
 *
 * Uses Codehooks REST API query format:
 *   q = JSON query object (MongoDB-style)
 *   h = hints: { $sort, $limit, $offset, $fields }
 */
export async function fetchCollection(collection, {
  query = {},
  sort = {},
  limit = 25,
  offset = 0,
  search = '',
  searchFields = [],
} = {}) {
  const q = { ...query };

  if (search && searchFields.length > 0) {
    q.$or = searchFields.map((field) => ({
      [field]: { $regex: search, $options: 'i' },
    }));
  }

  const params = new URLSearchParams();
  if (Object.keys(q).length > 0) {
    params.set('q', JSON.stringify(q));
  }
  params.set('h', JSON.stringify({ $sort: sort, $limit: limit, $offset: offset }));

  return request(`/api/${collection}?${params}`);
}

export async function fetchDocument(collection, id) {
  return request(`/api/${collection}/${id}`);
}

export async function createDocument(collection, data) {
  return request(`/api/${collection}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDocument(collection, id, data) {
  return request(`/api/${collection}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteDocument(collection, id) {
  return request(`/api/${collection}/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchDatamodel() {
  return request('/api/datamodel');
}

export async function updateDatamodel(data) {
  return request('/api/datamodel', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function fetchDatamodelPrompt({ includeData = false } = {}) {
  const params = includeData ? '?includeData=true' : '';
  return request(`/api/datamodel/prompt${params}`);
}

export async function fetchDatamodelVersions() {
  return request('/api/datamodel/versions');
}

export async function fetchDatamodelVersion(id) {
  return request(`/api/datamodel/versions/${id}`);
}

export async function fetchStats() {
  return request('/api/stats');
}

export async function uploadFile(file) {
  const params = new URLSearchParams({ filename: file.name });
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/files/upload?${params}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
  } catch {
    toast.error('Network error', { description: 'Could not reach the server.' });
    throw new Error('Network error — check your connection');
  }

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (res.status === 429) {
    toast.error('Rate limit exceeded', {
      description: 'Too many requests. A paid Codehooks plan may be required.',
      duration: 8000,
    });
    throw new Error('Rate limit exceeded');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

export function getFileUrl(path) {
  if (!path) return null;
  return `${BASE_URL}/api/files/download?path=${encodeURIComponent(path)}`;
}

export async function removeFile(path) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/files/delete?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    throw new Error('Network error — check your connection');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (res.status === 429) {
    toast.error('Rate limit exceeded', {
      description: 'Too many requests. A paid Codehooks plan may be required.',
      duration: 8000,
    });
    throw new Error('Rate limit exceeded');
  }
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Delete failed: ${res.status}`);
  }
}

export async function fetchAppConfig() {
  const res = await fetch(`${BASE_URL}/api/app`);
  if (!res.ok) return { title: 'Admin Panel', subtitle: '' };
  return res.json();
}

export async function fetchActivityLog({ action, collection, limit = 25, offset = 0 } = {}) {
  const query = {};
  if (action) query.action = action;
  if (collection) query.collection = collection;
  return fetchCollection('activitylog', {
    query,
    sort: { createdAt: -1 },
    limit,
    offset,
  });
}

export async function clearActivityLog() {
  return request('/api/admin/activitylog', { method: 'DELETE' });
}

// ---- User Management (admin only) ----
export async function fetchUsers() {
  return request('/api/admin/users');
}

export async function createUser(data) {
  return request('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUser(id, data) {
  return request(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id) {
  return request(`/api/admin/users/${id}`, {
    method: 'DELETE',
  });
}
