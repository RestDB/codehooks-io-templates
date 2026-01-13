import { app } from 'codehooks-js';

app.get('/test', (req, res) => {
  res.json({ message: 'test works' });
});

export default app.init();
