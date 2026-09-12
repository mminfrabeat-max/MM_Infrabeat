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

// Turns the MAIL_DIRECTORY variable into a name-to-address map.
//
// A bad value must never stop the server booting. The dashboard works perfectly well with
// no directory at all - every notification simply comes to MAIL_TO, saying who it was for -
// so a typo here is a warning and an empty map, not a crash at startup on a Sunday.
function parseDirectory(raw) {
  if (!raw || !raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('it must be a JSON object of "Name": "address" pairs');
    }
    // Only keep entries that are actually a name mapped to an address.
    return Object.fromEntries(
      Object.entries(parsed).filter(([name, address]) => name.trim() && typeof address === 'string' && address.includes('@'))
    );
  } catch (error) {
    console.error(`[api] MAIL_DIRECTORY could not be read, so no real mailboxes are known: ${error.message}`);
    return {};
  }
}

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
    // The name to write and show instead of the sign-in address.
    //
    // The address is the credential; it is not what a person is called. Stamping it into
    // the workbook's "Decided by" column and into the body of every notification put an
    // account name in front of people who only ever needed to know who approved something.
    // Falls back to the address when unset, so an unconfigured copy still records somebody.
    displayName: process.env.AUTH_DISPLAY_NAME || '',
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
    //
    // Also the catch-all: a notification for somebody who has no mailbox in MAIL_DIRECTORY
    // comes here instead, with a banner at the top naming who it was meant for. The
    // alternative was inventing an address from their name, which sent real mail to a
    // mailbox that did not exist and told nobody it had failed.
    to: process.env.MAIL_TO || '',
    // The Reply-To on messages that are pure information, such as the note sent to whoever
    // raised a document.
    //
    // It falls back to the sending account rather than to an invented no-reply address.
    // A made-up address on a domain nobody owns does not stop replies, it loses them: the
    // reply bounces and the person who wrote it assumes they were ignored. The message
    // says plainly that it needs no answer, and the Auto-Submitted header tells other mail
    // systems the same thing. Those do the job honestly; a dead address only looks like it
    // does. Set MAIL_NO_REPLY only if you own a real mailbox for it.
    noReply: process.env.MAIL_NO_REPLY || process.env.MAIL_USER || '',

    // Who the people named on the dashboard really are, as JSON in one variable:
    //   MAIL_DIRECTORY={"Mr. Anil Deshmukh":"someone@gmail.com", ...}
    //
    // This belongs on the server and nowhere else. It used to live in web/src/brand.js,
    // which is a browser file: every address in it was compiled into the JavaScript bundle,
    // served to anyone who opened the dashboard, packed into the shareable offline HTML,
    // and committed to a public repository. These are real people's personal mailboxes, and
    // none of those four things should ever have been true of them.
    //
    // Here, the browser never receives an address. It sends a name; this side turns the
    // name into a mailbox. And because it is an environment variable it stays out of git
    // like every other secret, and is set in the Render dashboard for the deployed copy.
    directory: parseDirectory(process.env.MAIL_DIRECTORY),
    // A deliberate off switch, separate from whether mail is configured.
    //
    // Emptying the password would also stop mail going out, but it loses the credential
    // and reads at boot as something broken. This says the silence was asked for, which
    // is what somebody wants to know when they come back to it a week later.
    enabled: process.env.MAIL_ENABLED !== 'false'
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
