// Signing in, signing out, and asking who is signed in.
//
// These three are deliberately NOT behind the sign-in guard, for the obvious reason that
// you cannot sign in through a door that requires you to already be signed in.

import { Router } from 'express';
import {
  checkPassword,
  createSession,
  destroySession,
  readSession,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
  isLockedOut,
  recordFailure,
  clearFailures,
  lockoutMinutes
} from '../auth.js';

export const authRouter = Router();

// POST /api/login  { username, password }
authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Enter both your email and your password.' });
  }

  if (isLockedOut(username)) {
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${lockoutMinutes} minutes.`
    });
  }

  if (!checkPassword(username, password)) {
    recordFailure(username);
    // One message for both a wrong email and a wrong password. Saying "no such user"
    // would tell someone which email addresses are real, which is a free head start.
    return res.status(401).json({ error: 'That email and password do not match.' });
  }

  clearFailures(username);
  const token = createSession(String(username).trim().toLowerCase());
  setSessionCookie(res, token);

  // The token goes in the cookie only, never in the reply body. If it were in the body,
  // the browser could read it, and the whole point of httpOnly would be lost.
  res.json({ signedIn: true, username: String(username).trim().toLowerCase() });
});

// POST /api/logout
authRouter.post('/logout', (req, res) => {
  destroySession(getSessionToken(req));
  clearSessionCookie(res);
  res.json({ signedIn: false });
});

// GET /api/session - who, if anyone, is signed in
//
// The app asks this on every page load to decide whether to show the dashboard or the
// sign-in screen. It answers 200 either way, because "nobody is signed in" is a normal
// answer to this question rather than an error.
authRouter.get('/session', (req, res) => {
  const session = readSession(getSessionToken(req));
  if (!session) return res.json({ signedIn: false });
  res.json({ signedIn: true, username: session.username });
});
