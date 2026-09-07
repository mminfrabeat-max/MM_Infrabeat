// Reads configuration once, at startup, and hands it to the rest of the backend.
// Nothing else in the codebase should touch process.env directly - that way there is
// exactly one place to look when you wonder "where does this setting come from?".

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// In ES modules there is no built-in __dirname, so we rebuild it from import.meta.url.
// import.meta.url is the full file:// address of THIS file.
const thisFolder = path.dirname(fileURLToPath(import.meta.url));

// .env sits at the repo root, two levels up from server/src.
// We pass an explicit path because npm runs the backend with server/ as the working
// directory, so dotenv's default "look for .env right here" would miss it.
const envPath = path.resolve(thisFolder, '../../.env');
dotenv.config({ path: envPath });

export const config = {
  port: Number(process.env.PORT) || 3001,

  // "mock" = local JSON files, "sap" = live sandbox calls. Set in .env.
  dataSource: (process.env.DATA_SOURCE || 'mock').toLowerCase(),

  sap: {
    baseUrl:
      process.env.SAP_BASE_URL ||
      'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/',
    apiKey: process.env.SAP_API_KEY || ''
  },

  auth: {
    username: process.env.AUTH_USERNAME || '',
    // Never the password itself, only a hash of it. Generate one with:
    //   node server/scripts/hash-password.js "the password"
    passwordHash: process.env.AUTH_PASSWORD_HASH || '',
    // Marks the session cookie as HTTPS-only. Must stay false on http://localhost or
    // the browser will refuse to store the cookie and sign-in will silently fail.
    // Set AUTH_SECURE_COOKIE=true when this is deployed behind HTTPS.
    secureCookie: process.env.AUTH_SECURE_COOKIE === 'true'
  }
};

// Sign-in is only enforced when both settings are present. Missing either one is almost
// always a half-finished .env rather than a deliberate choice, so the backend says so
// loudly at startup instead of quietly serving the data to anyone who asks.
export const authConfigured = Boolean(config.auth.username && config.auth.passwordHash);

// Handy for the health check: tells us a key was loaded WITHOUT ever exposing it.
// Never log config.sap.apiKey itself - terminal output ends up in screenshots and tickets.
export const hasSapKey =
  config.sap.apiKey.length > 0 &&
  config.sap.apiKey !== 'paste-your-sandbox-api-key-here';
