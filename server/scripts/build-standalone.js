// Packs the whole dashboard into one HTML file that opens by double-clicking.
//
//   node server/scripts/build-standalone.js
//
// No arguments, no password, and the backend does not need to be running.
//
// Why this is possible at all: the browser half of this app is already self-contained. It
// draws whatever the backend hands it and decides nothing itself. So if the data comes from
// somewhere else, everything still works.
//
// That is what this does. It takes the built app, the stylesheet, the logo and a snapshot
// of the real data, inlines all four into one file, and puts a small shim in front of
// fetch() so calls to /api are answered from the snapshot instead of a server.
//
// What you get is the real dashboard, with your real data, that runs with no Node, no
// database and no internet. Clicking approve visibly works and updates the screen, because
// the shim edits the snapshot in memory the same way the backend would edit the workbook.
//
// What you do NOT get, and the file says so on screen: nothing is saved and no mail is
// sent. Close the tab and every change is gone.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, hasSapKey } from '../src/config.js';
import { getEverything } from '../src/data-service.js';
import { readActionLog, canWrite } from '../src/store.js';
import { maskedAddress } from '../src/domain/recipients.js';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(thisFolder, '../..');
const dist = path.join(root, 'web', 'dist');

// --- Take a snapshot of the real data ----------------------------------------
//
// Read straight from the data layer rather than fetched over HTTP from the running server.
//
// It used to sign in to itself and call three endpoints, which meant the backend had to be
// up and you had to hand the script your dashboard password on the command line. Neither
// bought anything: this process can already open the same workbook. What it cost was that
// nobody could rebuild the offline copy without typing a password into a terminal, so the
// file went stale instead.
//
// The one thing that must not be lost in the change is the masking. /api/action-log hides
// recipient addresses before answering, precisely because this snapshot is what gets shared
// around, so the same masking is applied here from the same function.

async function snapshot() {
  const everything = await getEverything();

  return {
    dashboard: {
      ...everything,
      user: { email: config.auth.username },
      canDecide: canWrite(),
      dataSource: config.dataSource
    },
    actionLog: {
      entries: (await readActionLog()).map((entry) => ({ ...entry, emailTo: maskedAddress(entry.emailTo) })),
      available: canWrite()
    },
    health: {
      status: 'ok',
      service: 'procurement-dashboard-api',
      dataSource: config.dataSource,
      sapKeyLoaded: hasSapKey,
      checkedAt: new Date().toISOString()
    }
  };
}

// --- The shim ------------------------------------------------------------------
//
// Written as a string rather than a file because it has to be inlined. It replaces
// window.fetch, answers anything starting with /api from the snapshot, and passes anything
// else through untouched.

function buildShim(data) {
  return `
<script>
(function () {
  "use strict";

  // The snapshot. Everything the dashboard shows comes from here.
  var DATA = ${JSON.stringify(data)};

  // Marks this as a copy rather than the live system, so nobody mistakes one for the other.
  DATA.dashboard.isSnapshot = true;

  function reply(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" }
    }));
  }

  function now() {
    return new Date().toLocaleString("en-IN");
  }

  var OFFLINE_MAIL = {
    sent: false,
    to: "",
    status: "Not sent: this is an offline copy, with no mail server behind it"
  };

  // Changes are made to the snapshot in memory, exactly as the backend edits the workbook.
  // The screen updates because the app re-reads the dashboard after every action.
  function decide(id, status, note) {
    var doc = DATA.dashboard.documents.find(function (d) { return d.id === id; });
    if (!doc) return reply({ error: "No document found with the number " + id + "." }, 404);
    if (doc.status !== "pending") {
      return reply({ error: id + " was already " + doc.status + ". Refresh to see the current position." }, 409);
    }

    doc.status = status;
    doc.decidedBy = DATA.dashboard.user.email;
    doc.decidedAt = now();
    doc.decisionNote = note || "";

    DATA.actionLog.entries.unshift({
      at: doc.decidedAt, action: status, documentId: id, documentType: doc.kind,
      supplierName: doc.supplierName, value: doc.total,
      decidedBy: doc.decidedBy, note: note || "",
      emailTo: "", emailStatus: OFFLINE_MAIL.status
    });

    return reply({
      status: status, documentId: id, decidedBy: doc.decidedBy, decidedAt: doc.decidedAt,
      saved: true, email: OFFLINE_MAIL
    });
  }

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api") === -1) return realFetch(input, init);

    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }

    // Signed in already: there is no server to check a password against, and a sign-in
    // screen with no way past it would just be a locked door.
    if (url.indexOf("/api/session") === 0) {
      return reply({ signedIn: true, username: DATA.dashboard.user.email });
    }
    if (url.indexOf("/api/login") === 0) {
      return reply({ signedIn: true, username: DATA.dashboard.user.email });
    }
    if (url.indexOf("/api/logout") === 0) {
      return reply({ signedIn: false });
    }
    if (url.indexOf("/api/health") === 0) return reply(DATA.health);
    if (url.indexOf("/api/dashboard") === 0) return reply(DATA.dashboard);
    if (url.indexOf("/api/action-log") === 0) return reply(DATA.actionLog);

    var approve = url.match(/\\/api\\/approvals\\/([^/]+)\\/approve/);
    if (approve) return decide(decodeURIComponent(approve[1]), "approved", body.note);

    var reject = url.match(/\\/api\\/approvals\\/([^/]+)\\/reject/);
    if (reject) return decide(decodeURIComponent(reject[1]), "rejected", body.note);

    var fix = url.match(/\\/api\\/situations\\/([^/]+)\\/fix/);
    if (fix) {
      var ref = decodeURIComponent(fix[1]);
      var s = DATA.dashboard.situations.find(function (x) { return x.id === ref; });
      if (!s) return reply({ error: "No problem found with reference " + ref + "." }, 404);
      if (s.status !== "open") return reply({ error: ref + " has already been handled." }, 409);
      s.status = "fixed";
      DATA.actionLog.entries.unshift({
        at: now(), action: "problem fixed", documentId: ref, documentType: "",
        supplierName: s.relatedTo, value: "", decidedBy: DATA.dashboard.user.email,
        note: s.fix, emailTo: "", emailStatus: ""
      });
      return reply({ id: ref, status: "fixed", fixedAt: now(), fix: s.fix });
    }

    var request = url.match(/\\/api\\/materials\\/([^/]+)\\/request/);
    if (request) {
      var code = decodeURIComponent(request[1]);
      var m = DATA.dashboard.materials.find(function (x) { return x.code === code && x.plant === body.plant; });
      if (!m) return reply({ error: code + " is not held at " + (body.plant || "that plant") + "." }, 404);
      var qty = m.suggestedOrderQuantity;
      if (qty <= 0) return reply({ error: m.name + " does not need an order right now." }, 409);

      // Recalculate the same way the backend does, so the screen stays consistent.
      m.openOrderQuantity += qty;
      m.available = m.onHand + m.openOrderQuantity;
      m.shortBy = m.totalNeeded - m.available;
      m.daysOfCover = m.dailyUsage > 0 ? Math.round((m.available / m.dailyUsage) * 10) / 10 : 999;
      m.runsOutFirst = m.daysOfCover < m.leadTimeDays;
      m.band = m.shortBy > 0 ? "risk" : m.runsOutFirst ? "watch" : "good";

      DATA.actionLog.entries.unshift({
        at: now(), action: "request raised", documentId: code, documentType: "",
        supplierName: m.supplierName, value: "", decidedBy: DATA.dashboard.user.email,
        note: qty + " " + m.unit + " of " + m.name + " at " + m.plant,
        emailTo: "", emailStatus: ""
      });
      return reply({ code: code, plant: m.plant, quantity: qty, unit: m.unit, raisedAt: now() });
    }

    if (url.indexOf("/api/mail") === 0) {
      DATA.actionLog.entries.unshift({
        at: now(), action: "mail sent", documentId: "", documentType: "", supplierName: "",
        value: "", decidedBy: DATA.dashboard.user.email, note: body.subject || "",
        emailTo: body.to || "", emailStatus: OFFLINE_MAIL.status
      });
      return reply({ sent: false, to: body.to, status: OFFLINE_MAIL.status });
    }

    return reply({ error: "Not available in the offline copy." }, 404);
  };
})();
</script>`;
}

// A quiet strip along the top, so nobody demonstrates this thinking decisions are being
// saved. Honest labelling costs nothing and prevents an awkward conversation.
const BANNER = `
<style>
  .snapshot-note {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 200;
    background: #BE6A00; color: #fff; font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 12.4px; padding: 7px 16px; text-align: center; line-height: 1.5;
  }
  .snapshot-note b { font-weight: 700; }
  body { padding-bottom: 34px; }
</style>
<div class="snapshot-note">
  <b>Offline copy.</b> Everything works and nothing is kept &mdash; approvals are not saved
  and no mail is sent. The live dashboard writes to the workbook and sends for real.
</div>`;

// --- Assemble ------------------------------------------------------------------

async function main() {
  const indexHtml = await fs.readFile(path.join(dist, 'index.html'), 'utf8');

  // Find what the built page references, rather than assuming the hashed filenames.
  const jsFile = indexHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  const cssFile = indexHtml.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
  if (!jsFile || !cssFile) {
    throw new Error('Could not find the built script and stylesheet. Run `npm run build` first.');
  }

  const [js, css, logo] = await Promise.all([
    fs.readFile(path.join(dist, jsFile), 'utf8'),
    fs.readFile(path.join(dist, cssFile), 'utf8'),
    fs.readFile(path.join(root, 'web', 'public', 'infrabeat-logo.png'))
  ]);

  const data = await snapshot();
  const logoUri = `data:image/png;base64,${logo.toString('base64')}`;

  // Every replacement below passes a FUNCTION rather than a string, and that is not a style
  // choice - it is the whole reason this file works.
  //
  // String.replace treats $ in a STRING replacement as special: $& means "whatever was
  // matched", $1 a capture group, $` and $' the text either side. The things being inserted
  // here are a minified React bundle and a base64 image, and minified React contains the
  // sequence `!$&&(`. Inserting it as a string turned that into `!</body>&(`, which is not
  // JavaScript, and the page died before it drew anything. It failed silently: the file was
  // the right size, opened without complaint, and showed a blank screen.
  //
  // A function replacement is returned verbatim, with no $ handling at all. Nothing being
  // inlined here is under our control, so nothing here may go in as a string.
  const insert = (text) => () => text;

  // The logo goes into the bundle here, before it is inlined, rather than into the whole
  // document afterwards. Doing it first is what lets the check at the bottom compare the
  // bundle that landed against the exact bundle that was meant to land.
  const bundle = js.replace(/"\/infrabeat-logo\.png"/g, insert(JSON.stringify(logoUri)));

  let html = indexHtml
    // The stylesheet and script become inline, so there is nothing left to fetch.
    .replace(/<link rel="stylesheet"[^>]*>/, insert(`<style>\n${css}\n</style>`))
    .replace(/<script type="module"[^>]*><\/script>/, '')
    // The logo is referenced by path in the code; the data URI replaces it everywhere.
    .replace(/href="\/infrabeat-logo\.svg"/g, insert(`href="${logoUri}"`));

  // The shim has to run before the app, so it is in place by the time anything calls fetch.
  html = html.replace(
    '</body>',
    insert(`${buildShim(data)}\n<script type="module">\n${bundle}\n</script>\n${BANNER}\n</body>`)
  );

  // Prove the bundle went in exactly as it came out of the build, before writing anything.
  //
  // The bug this catches produced a file of the right size that opened without complaint and
  // drew a blank page, which is the worst way for a build to fail: nothing to read, nothing
  // in a log, and no reason to suspect the file rather than the browser. Comparing what
  // landed against what was read costs a millisecond and turns that into a message.
  const inlined = html.match(/<script type="module">\n([\s\S]*?)\n<\/script>/);
  if (!inlined) {
    throw new Error('The app bundle is missing from the assembled file.');
  }
  if (inlined[1] !== bundle) {
    throw new Error(
      'The app bundle was altered while being inlined, so the offline copy would not run.\n' +
        `It went in at ${bundle.length} characters and came out at ${inlined[1].length}.\n` +
        'Every replacement in this script must pass a function, never a string: $ sequences ' +
        'in a string replacement are substituted, and minified React contains "$&".'
    );
  }

  const out = path.join(root, 'InfraBeat-Dashboard-offline.html');
  await fs.writeFile(out, html, 'utf8');

  const size = (await fs.stat(out)).size;
  console.log('');
  console.log(`Created ${out}`);
  console.log(`  ${(size / 1024).toFixed(0)} KB, one file, opens by double-clicking`);
  console.log('');
  console.log('  documents  ' + data.dashboard.documents.length);
  console.log('  vendors    ' + data.dashboard.suppliers.length);
  console.log('  materials  ' + data.dashboard.materials.length);
  console.log('  problems   ' + data.dashboard.situations.length);
  console.log('  teams      ' + data.dashboard.teams.length);
  console.log('  log        ' + data.actionLog.entries.length + ' entries');
  console.log('');
}

main().catch((error) => {
  console.error('');
  console.error(error.message);
  console.error('');
  console.error('The dashboard must be running for this to take a snapshot: npm run serve');
  console.error('');
  process.exit(1);
});
