// Sign-in for the dashboard.
//
// The shape of it: the browser posts a username and password once, the backend checks
// them and hands back a random session token in a cookie, and every later request
// carries that cookie automatically. The password itself is sent exactly once and is
// never stored anywhere on the browser side.
//
// Sessions are kept in memory, which means restarting the backend signs everyone out.
// That is fine here and it is the honest choice while we have no database: the
// alternative is pretending a Map survives a restart when it does not.

import crypto from 'node:crypto';
import { config } from './config.js';

// token -> { username, expiresAt }
const sessions = new Map();

const SESSION_COOKIE = 'procurement_session';
const SESSION_HOURS = 8; // A working day. Sign-in should not outlive the shift.

// --- Password checking ------------------------------------------------------

// Splits the "scrypt$salt$key" line stored in .env back into its parts.
function parseStoredHash(stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return null;
  return { salt: Buffer.from(parts[1], 'hex'), key: Buffer.from(parts[2], 'hex') };
}

// Compares two secrets without leaking, through how long the comparison takes, how many
// characters were right. A normal === stops at the first wrong character, so a patient
// attacker could measure the difference and work the value out one character at a time.
// timingSafeEqual always takes the same time. It needs both sides to be the same length,
// hence the length check first.
function sameSecret(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

export function checkPassword(username, password) {
  if (!config.auth.username || !config.auth.passwordHash) return false;

  const stored = parseStoredHash(config.auth.passwordHash);
  if (!stored) return false;

  // Usernames are not case sensitive. Email addresses rarely are, and nobody should be
  // locked out for typing a capital M.
  const usernameMatches = sameSecret(
    String(username || '').trim().toLowerCase(),
    config.auth.username.toLowerCase()
  );

  // Hash the attempt with the SAME salt, then compare the results. This is the only way
  // to check a password against a hash: you cannot un-hash the stored one.
  let passwordMatches = false;
  try {
    const attempt = crypto.scryptSync(String(password || ''), stored.salt, stored.key.length);
    passwordMatches = crypto.timingSafeEqual(attempt, stored.key);
  } catch {
    passwordMatches = false;
  }

  // Both checks always run, so a wrong username and a wrong password take the same time
  // and look identical from outside.
  return usernameMatches && passwordMatches;
}

// --- Sessions ---------------------------------------------------------------

export function createSession(username) {
  // 32 random bytes is far too many to guess. Do not be tempted by Math.random() here:
  // it is predictable, and predictable session tokens can be forged.
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  sessions.set(token, { username, expiresAt });
  return token;
}

export function readSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;

  // An expired token is deleted on sight, so the Map does not grow forever.
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function destroySession(token) {
  if (token) sessions.delete(token);
}

// --- Cookies ----------------------------------------------------------------

// Express does not parse cookies on its own. Rather than add a package for it, this
// reads the one header we need. A cookie header looks like "a=1; b=2".
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function setSessionCookie(res, token) {
  res.append('Set-Cookie', [
    `${SESSION_COOKIE}=${token}`,
    // httpOnly means JavaScript in the page cannot read this cookie. If someone ever
    // manages to inject a script into the dashboard, they still cannot steal the session.
    'HttpOnly',
    'Path=/',
    // SameSite=Lax stops another website from making the browser send this cookie on a
    // request it triggered, which is how cross-site request forgery works.
    'SameSite=Lax',
    `Max-Age=${SESSION_HOURS * 60 * 60}`,
    // Secure would require HTTPS. We run on plain http://localhost in development, so
    // setting it here would break sign-in entirely. Turn it on when this is deployed.
    ...(config.auth.secureCookie ? ['Secure'] : [])
  ].join('; '));
}

export function clearSessionCookie(res) {
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
  );
}

export function getSessionToken(req) {
  return readCookie(req, SESSION_COOKIE);
}

// --- Slowing down guessing --------------------------------------------------

// Counts failed attempts per username so somebody cannot try thousands of passwords.
// In memory, like the sessions, and cleared by a restart.
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

export function isLockedOut(username) {
  const record = failedAttempts.get(String(username || '').toLowerCase());
  if (!record) return false;
  if (record.until < Date.now()) {
    failedAttempts.delete(String(username || '').toLowerCase());
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

export function recordFailure(username) {
  const key = String(username || '').toLowerCase();
  const record = failedAttempts.get(key) || { count: 0, until: 0 };
  record.count += 1;
  record.until = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
  failedAttempts.set(key, record);
}

export function clearFailures(username) {
  failedAttempts.delete(String(username || '').toLowerCase());
}

export const lockoutMinutes = LOCKOUT_MINUTES;

// --- The guard --------------------------------------------------------------

// Put in front of every route that returns real data. Anything without a valid session
// gets 401 and no data at all.
export function requireSignIn(req, res, next) {
  const session = readSession(getSessionToken(req));

  if (!session) {
    return res.status(401).json({ error: 'Please sign in to see this.' });
  }

  // Hand the signed-in user to the rest of the request, which milestone 5 will need in
  // order to record who approved what.
  req.user = { username: session.username };
  next();
}
