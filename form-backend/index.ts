import { app } from 'codehooks-js';

app.auth('/health', (req, res, next) => next());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'form-backend' });
});

export default app.init();
