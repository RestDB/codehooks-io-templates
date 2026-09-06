import { app } from 'codehooks-js';

// The example client is a plain static page. It holds no secrets and talks to the
// form backend from the browser, cross-origin — which is the point of deploying it
// to its own space: it exercises the backend's domain allowlist and CORS handling
// the way a real customer's site would.
app.auth('/*', (req, res, next) => next());

app.static({ route: '/', directory: '/public', default: 'index.html' });

export default app.init();
