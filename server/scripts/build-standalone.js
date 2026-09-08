// Packs the whole dashboard into one HTML file that opens by double-clicking.
//
//   node server/scripts/build-standalone.js
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
import { config } from '../src/config.js';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(thisFolder, '../..');
const dist = path.join(root, 'web', 'dist');

const BASE = `http://localhost:${config.port}`;

// --- Take a snapshot of the real data ----------------------------------------

async function snapshot() {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.auth.username, password: process.argv[2] })
  });

  if (!login.ok) {
    throw new Error(
      'Could not sign in to take the snapshot. Pass the dashboard password as an argument:\n' +
        '  node server/scripts/build-standalone.js "your password"'
    );
  }

  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const get = async (p) => {
    const r = await fetch(`${BASE}${p}`, { headers: { cookie } });
    if (!r.ok) throw new Error(`${p} returned ${r.status}`);
    return r.json();
  };

  return {
    dashboard: await get('/api/dashboard'),
    actionLog: await get('/api/action-log'),
    health: await get('/api/health')
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

  let html = indexHtml
    // The stylesheet and script become inline, so there is nothing left to fetch.
    .replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
    .replace(/<script type="module"[^>]*><\/script>/, '')
    // The logo is referenced by path in the code; the data URI replaces it everywhere.
    .replace(/href="\/infrabeat-logo\.svg"/g, `href="${logoUri}"`);

  // The shim has to run before the app, so it is in place by the time anything calls fetch.
  html = html.replace('</body>', `${buildShim(data)}\n<script type="module">\n${js}\n</script>\n${BANNER}\n</body>`);

  // And the logo path inside the bundle itself.
  html = html.replace(/"\/infrabeat-logo\.png"/g, JSON.stringify(logoUri));

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
