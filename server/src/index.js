// Entry point for the backend.
//
// Why this layer exists at all: the browser must never call SAP directly, because that
// would ship the API key to every visitor's laptop. The React app calls this Express
// server, and only this server holds the credentials and talks to SAP.

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, hasSapKey, authConfigured } from './config.js';
import { requireSignIn } from './auth.js';
import { verifyMail, mailConfigured } from './mailer.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { actionsRouter } from './routes/actions.js';

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

app.use(express.json());

// --- Open routes -------------------------------------------------------------
// Two things must work before anyone is signed in: checking the backend is alive, and
// signing in itself.
app.use('/api', healthRouter);
app.use('/api', authRouter);

// --- Everything below requires a signed-in session ---------------------------
// One line, applied once. A route added after this point is protected by default, which is
// the right way round: forgetting to protect something should be impossible rather than
// merely unlikely.
app.use('/api', requireSignIn);

app.use('/api', dashboardRouter);
app.use('/api', actionsRouter);

// Any unknown /api/... URL returns JSON, not an HTML error page. Without this, fetch() in
// the browser would try to parse HTML as JSON and give you a confusing error.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// --- Serving the dashboard itself --------------------------------------------
//
// In development the React app runs on Vite's own server, which handles hot reloading and
// proxies /api here. That server is a development tool and should never be put in front of
// other people.
//
// So for anyone else to use this, Express serves the BUILT app instead: one process, one
// port, one address to hand out. Run `npm run build` first, then `npm start`.
//
// This block sits AFTER the /api routes on purpose. Express matches in order, so anything
// starting with /api is already answered above and never reaches the catch-all below.
const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const builtApp = path.resolve(thisFolder, '../../web/dist');
const hasBuiltApp = fs.existsSync(path.join(builtApp, 'index.html'));

if (hasBuiltApp) {
  app.use(express.static(builtApp));

  // A single-page app owns its own routing, so any address that is not a file has to be
  // answered with index.html and let the browser sort it out. Without this, refreshing on
  // a sub-page would 404.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(builtApp, 'index.html'));
  });
}

// Express error handler. It must take exactly these four arguments - that is how Express
// recognises it as an error handler rather than a normal route.
app.use((err, req, res, next) => {
  console.error('[api] unhandled error:', err.message);
  // The message is written for a person to read, so it is safe to show on screen.
  // Never put a stack trace or a credential in here - this text reaches the browser.
  res.status(500).json({ error: err.message || 'Something went wrong on the server' });
});

// Listening on 0.0.0.0 rather than localhost is what lets anyone else reach this at all.
// localhost means "this machine only" - a colleague typing your address would get nothing.
app.listen(config.port, '0.0.0.0', async () => {
  console.log(`[api] listening on http://localhost:${config.port}`);

  if (hasBuiltApp) {
    // Print every address this machine can be reached on, so there is something concrete
    // to hand a colleague rather than telling them to work out your IP.
    const { networkInterfaces } = await import('node:os');
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address);

    console.log('[api] serving the dashboard from web/dist');
    for (const address of addresses) {
      console.log(`[api]   others on this network: http://${address}:${config.port}`);
    }
  } else {
    console.log('[api] no built app found. Run `npm run build` to serve it from here,');
    console.log('[api] or use `npm run dev` for the development server on port 5173.');
  }

  console.log(`[api] data source: ${config.dataSource}`);
  console.log(`[api] SAP API key loaded: ${hasSapKey ? 'yes' : 'no'}`);
  // The name is printed too, because it is read from .env and nodemon does not watch
  // .env: without this line a stale value looks exactly like a working one.
  console.log(
    `[api] sign-in required as: ${config.auth.username}` +
      (config.auth.displayName ? ` (recorded as "${config.auth.displayName}")` : ' (no AUTH_DISPLAY_NAME set, decisions will record the address)')
  );

  // Check the mail credentials now, while you are looking at the terminal, rather than
  // discovering they are wrong on the first approval of the day.
  if (!mailConfigured()) {
    console.log('[api] email: not configured, actions will save but send nothing');
  } else {
    const result = await verifyMail();
    console.log(
      result.ok
        ? `[api] email: ready, sending as ${config.mail.user}`
        : `[api] email: NOT WORKING - ${result.reason}`
    );
  }
});
