// Entry point for the backend.
//
// Why this layer exists at all: the browser must never call SAP directly, because that
// would ship the API key to every visitor's laptop. The React app calls this Express
// server, and only this server holds the credentials and talks to SAP.

import express from 'express';
import { config, hasSapKey, authConfigured } from './config.js';
import { requireSignIn } from './auth.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { todayRouter } from './routes/today.js';
import { approvalsRouter } from './routes/approvals.js';
import { suppliersRouter } from './routes/suppliers.js';
import { stockRouter } from './routes/stock.js';

// Refuse to start rather than serve procurement data to anyone who finds the port.
if (!authConfigured) {
  console.error('');
  console.error('[api] Cannot start: sign-in is not configured.');
  console.error('[api] Your .env needs both of these:');
  console.error('[api]   AUTH_USERNAME=you@example.com');
  console.error('[api]   AUTH_PASSWORD_HASH=scrypt$...');
  console.error('[api] Generate the hash with:');
  console.error('[api]   node server/scripts/hash-password.js "your password"');
  console.error('');
  process.exit(1);
}

const app = express();

// Lets the app read JSON request bodies. The sign-in form needs this.
app.use(express.json());

// --- Open routes ------------------------------------------------------------
// Two things must work before anyone is signed in: checking the backend is alive, and
// signing in itself.
app.use('/api', healthRouter);
app.use('/api', authRouter);

// --- Everything below requires a signed-in session --------------------------
// One line, applied once. A new data route added after this point is protected by
// default, which is the right way round: forgetting to protect something should be
// impossible rather than merely unlikely.
app.use('/api', requireSignIn);

app.use('/api', todayRouter);
app.use('/api', approvalsRouter);
app.use('/api', suppliersRouter);
app.use('/api', stockRouter);

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
  // The message is written for a person to read, so it is safe to show on screen.
  // Never put a stack trace or a credential in here - this text reaches the browser.
  res.status(500).json({
    error: err.message || 'Something went wrong on the server'
  });
});

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] data source: ${config.dataSource}`);
  console.log(`[api] SAP API key loaded: ${hasSapKey ? 'yes' : 'no'}`);
  console.log(`[api] sign-in required as: ${config.auth.username}`);
});
