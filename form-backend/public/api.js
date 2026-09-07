// The only module that calls fetch. Everything else works in terms of these
// functions, so auth handling and error shape live in exactly one place.

async function call(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });

  // A 401 from the login endpoint itself doesn't mean a session expired --
  // there was never one to expire, and firing `session-expired` here has
  // nothing to do: the login gate is already showing. It means the submitted
  // password was wrong (or throttled). Skip straight to the normal
  // body-parsing path below, which surfaces the server's own message
  // (`payload.error`, e.g. "Invalid password") instead of overwriting it.
  if (res.status === 401 && path !== '/admin/login') {
    window.dispatchEvent(new CustomEvent('session-expired'));
    throw new Error('Your session has expired. Sign in again.');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    throw new Error('The server returned a response this page could not read.');
  }

  if (payload === null || typeof payload !== 'object') payload = {};

  // The platform answers an unhandled exception with HTTP 200 and {fatal: true}.
  // All three clauses are needed: !res.ok for network errors, payload.ok for
  // explicit failures, and payload.fatal for crashed routes.
  if (!res.ok || payload.ok === false || payload.fatal === true) {
    const err = new Error(payload.error || payload.text || ('Request failed (' + res.status + ')'));
    err.status = res.status;
    // The login throttle (index.ts) sends `Retry-After` on a 429 so the caller
    // can tell a visitor when retrying becomes useful, rather than just "later".
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After'), 10);
      err.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
    }
    throw err;
  }
  return payload;
}

const body = (obj) => ({ method: 'POST', body: JSON.stringify(obj) });

export const login = (password) => call('/admin/login', body({ password }));
export const logout = () => call('/admin/logout', { method: 'POST' });

export const listForms = () => call('/admin/api/forms');
export const createForm = (name) => call('/admin/api/forms', body({ name }));
export const getForm = (id) => call('/admin/api/forms/' + encodeURIComponent(id));
export const patchForm = (id, patch) =>
  call('/admin/api/forms/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteForm = (id) =>
  call('/admin/api/forms/' + encodeURIComponent(id), { method: 'DELETE' });
export const getSnippet = (id) => call('/admin/api/forms/' + encodeURIComponent(id) + '/snippet');
export const listDeliveries = (id) => call('/admin/api/forms/' + encodeURIComponent(id) + '/deliveries');

export const listSubmissions = (formId, query) =>
  call('/admin/api/forms/' + encodeURIComponent(formId) + '/submissions' + (query ? '?' + query : ''));
export const getSubmission = (id) => call('/admin/api/submissions/' + encodeURIComponent(id));
export const patchSubmission = (id, patch) =>
  call('/admin/api/submissions/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteSubmission = (id) =>
  call('/admin/api/submissions/' + encodeURIComponent(id), { method: 'DELETE' });

export const fileUrl = (submissionId, fileId) =>
  '/admin/api/submissions/' + encodeURIComponent(submissionId) + '/files/' + encodeURIComponent(fileId);
export const exportUrl = (formId) =>
  '/admin/api/forms/' + encodeURIComponent(formId) + '/export.csv';
