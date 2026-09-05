// Entry point for the backend.
//
// Why this layer exists at all: the browser must never call SAP directly, because that
// would ship the API key to every visitor's laptop. The React app calls this Express
// server, and only this server holds the credentials and talks to SAP.

import express from 'express';
import { config, hasSapKey } from './config.js';
import { healthRouter } from './routes/health.js';

const app = express();

// Lets the app read JSON request bodies (needed later for approve/reject).
app.use(express.json());

// Everything the frontend calls lives under /api, so the Vite proxy has one clear prefix.
app.use('/api', healthRouter);

// Any unknown /api/... URL returns JSON, not an HTML error page. Without this, fetch()
// in the browser would try to parse HTML as JSON and give you a confusing error.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Express error handler. It must take exactly these four arguments - that is how Express
// recognises it as an error handler rather than a normal route.
// Any error thrown in a route lands here, so the browser gets a readable message
// instead of a hung request.
app.use((err, req, res, next) => {
  console.error('[api] unhandled error:', err.message);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] data source: ${config.dataSource}`);
  console.log(`[api] SAP API key loaded: ${hasSapKey ? 'yes' : 'no'}`);
});
