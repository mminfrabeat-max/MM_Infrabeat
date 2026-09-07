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

  // Where the data lives. Set in .env.
  //   excel - the Excel workbook in server/data. The only one that can be written to.
  //   mock  - the read-only JSON files. Useful for a clean demo.
  //   sap   - the live sandbox (milestone 4).
  dataSource: (process.env.DATA_SOURCE || 'excel').toLowerCase(),

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
  },

  mail: {
    host: process.env.MAIL_HOST || '',
    // 587 starts plain and upgrades to TLS. 465 is TLS from the first byte.
    port: Number(process.env.MAIL_PORT) || 587,
    user: process.env.MAIL_USER || '',
    // For Gmail this must be a 16-character App Password, never the account password.
    password: process.env.MAIL_PASSWORD || '',
    // What the recipient sees in the From line. Defaults to the sending account.
    from: process.env.MAIL_FROM || '',
    // Who gets the approval notice. Defaults to whoever made the decision.
    to: process.env.MAIL_TO || ''
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
