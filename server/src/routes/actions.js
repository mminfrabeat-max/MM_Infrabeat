// Everything the manager can actually DO: approve, send back, clear a problem, raise a
// request, and write a mail.
//
// One rule runs through all of them, and the order of operations enforces it:
//
//   1. Write the change to the store
//   2. Then try to send the email
//   3. Then record how the email went
//
// Saving first means a mail failure can never lose a decision. The reverse order could
// leave you having emailed a vendor about an approval that was never recorded.
//
// Where the change is saved depends on DATA_SOURCE, and this file does not know or care.
// With the database it is one transaction; with the workbook it is a sequence. store.js
// holds that difference.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getDocuments, getSituations, getStock, getSupplierScores } from '../data-service.js';
import * as store from '../store.js';
import { sendDecisionEmail, sendInitiatorEmail, sendPlainEmail, sendVendorOrder } from '../mailer.js';
import { canDecide, outcomeOf, outcomeSentence, whoseTurn } from '../domain/approvals.js';
import { canAdvanceTo, currentStage, isTrackable, LAST_STAGE, STAGES } from '../domain/shipment.js';

const STAGE_COUNT = STAGES.length;
import { readIntent } from '../domain/ask.js';
import { recipientFor, maskedAddress } from '../domain/recipients.js';
import { config } from '../config.js';

export const actionsRouter = Router();

function requireWritableSource(res) {
  if (!store.canWrite()) {
    res.status(409).json({
      error:
        `Changes cannot be saved with DATA_SOURCE="${config.dataSource}". ` +
        `Set it to "db" for SQLite or "excel" for the workbook, then restart the backend.`
    });
    return false;
  }
  return true;
}

function stamp() {
  return new Date().toLocaleString('en-IN');
}

// Strips the recipient address off a mail result before it goes to the browser.
//
// `delivered` is what is left, and it is the part that matters on screen: true means it
// reached the person named, false means there was no mailbox on file and it came back to
// the operator instead. Both are worth saying; neither needs an address to say it.
function withoutAddress(mail) {
  if (!mail) return mail;
  const { to, preview, ...rest } = mail;
  return rest;
}

// --- Approve and send back ---------------------------------------------------

async function decide(req, res, action) {
  if (!requireWritableSource(res)) return;

  const documentId = req.params.id;
  const note = String(req.body?.note || '').trim();
  const documents = await getDocuments();
  const document = documents.find((d) => d.id === documentId);

  if (!document) {
    return res.status(404).json({ error: `No document found with the number ${documentId}.` });
  }

  // Guards against a double click, a stale browser tab, or two people acting at once.
  //
  // Only a document that is finished with lands here now. One that has moved on to the next
  // approver is still open to a decision - the manager records theirs - so it passes the
  // guard rather than being refused by it.
  if (!canDecide(document)) {
    return res.status(409).json({
      error: `${documentId} was already ${document.status}${
        document.decidedBy ? ` by ${document.decidedBy}` : ''
      }. Refresh to see the current position.`
    });
  }

  // Whose decision this is.
  //
  // Usually the manager's own. On a document they have already signed it is the approver
  // it moved to, whose decision they are recording - so the step is stamped with THAT
  // name. It is worked out here, after the document has been found and checked, because
  // it is a fact about the document rather than about the request.
  const actingFor = whoseTurn(document, req.user.name);
  const decidedBy = actingFor.name;
  // The mailbox a reply goes to is always the person at the keyboard, whoever the
  // decision belongs to: they are the one who can answer a question about it. Never taken
  // from the request body - if the browser could say who approved something, anyone could
  // approve as anyone.
  const decidedByAddress = req.user.username;

  // The one decision this route is really making. Everything below carries it out.
  const outcome = outcomeOf(document, action);
  const at = stamp();
  const sentence = outcomeSentence(document, outcome, decidedBy);

  // Both mails are attempted before the save so their outcome can be recorded in the same
  // transaction. Neither throws; each returns a status string instead, so no mail failure
  // can stop the decision being saved a moment later.
  //
  // They go together rather than one after the other. Each waits up to fifteen seconds on a
  // slow mail server, and nobody should sit in front of a "Saving..." button for thirty.
  const [mail, initiatorMail] = await Promise.all([
    // To the next approver when there is one, otherwise the record copy as before.
    sendDecisionEmail({
      document,
      decision: outcome.final ? outcome.status : 'approved',
      decidedBy,
      decidedByAddress,
      note,
      movedTo: outcome.movedTo
    }),
    // To whoever raised it, every time, whatever the outcome.
    sendInitiatorEmail({ document, outcome, decidedBy, note, sentence })
  ]);

  await store.saveDecision({
    documentId,
    status: outcome.status,
    decidedBy,
    decidedByAddress,
    decidedAt: at,
    note,
    document,
    mail,
    outcome,
    initiatorMail
  });

  // A released purchase order goes to the vendor, and only then. Not on the first
  // approval of a two step order - that one is not released and mailing it would be
  // telling a vendor to start on something that has not been agreed - and never for a
  // requisition, which commits nobody to anything.
  let vendorMail = null;
  if (outcome.final && outcome.status === 'approved' && document.kind === 'PO') {
    vendorMail = await sendVendorOrder({ document, releasedBy: decidedBy });
  }

  res.json({
    status: outcome.status,
    final: outcome.final,
    vendorEmail: withoutAddress(vendorMail),
    movedTo: outcome.movedTo,
    step: outcome.step,
    sentence,
    documentId,
    decidedBy,
    decidedAt: at,
    saved: true,
    // Whether each mail left, and whether it reached the person it names - but never the
    // address. The screen has a name to show; the browser has no business knowing mailboxes.
    email: withoutAddress(mail),
    initiatorEmail: withoutAddress(initiatorMail)
  });
}

// POST /api/approvals/:id/approve   { note }
actionsRouter.post('/approvals/:id/approve', asyncHandler((req, res) => decide(req, res, 'approve')));

// POST /api/approvals/:id/reject    { note }
actionsRouter.post('/approvals/:id/reject', asyncHandler((req, res) => decide(req, res, 'reject')));

// --- Clearing a problem ------------------------------------------------------

// POST /api/situations/:id/fix
actionsRouter.post(
  '/situations/:id/fix',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const situations = await getSituations();
    const situation = situations.find((s) => s.id === req.params.id);

    if (!situation) {
      return res.status(404).json({ error: `No problem found with reference ${req.params.id}.` });
    }
    if (situation.status !== 'open') {
      return res.status(409).json({ error: `${situation.id} has already been handled.` });
    }

    const at = stamp();
    await store.saveSituationFix({
      reference: situation.id,
      relatedTo: situation.relatedTo,
      fix: situation.fix,
      fixedAt: at,
      fixedBy: req.user.name,
      fixedByAddress: req.user.username
    });

    res.json({ id: situation.id, status: 'fixed', fixedAt: at, fix: situation.fix });
  })
);

// --- Raising a request against a short material ------------------------------

// POST /api/materials/:code/request   { plant }
actionsRouter.post(
  '/materials/:code/request',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const plant = String(req.body?.plant || '').trim();
    const materials = await getStock();
    const material = materials.find((m) => m.code === req.params.code && m.plant === plant);

    if (!material) {
      return res.status(404).json({ error: `${req.params.code} is not held at ${plant || 'that plant'}.` });
    }
    if (material.suggestedOrderQuantity <= 0) {
      return res.status(409).json({ error: `${material.name} at ${plant} does not need an order right now.` });
    }

    const quantity = material.suggestedOrderQuantity;
    const at = stamp();

    await store.saveStockRequest({
      materialCode: material.code,
      plant: material.plant,
      quantity,
      unit: material.unit,
      materialName: material.name,
      supplierName: material.supplierName,
      newOpenOrderQuantity: material.openOrderQuantity + quantity,
      raisedAt: at,
      raisedBy: req.user.name,
      raisedByAddress: req.user.username
    });

    res.json({ code: material.code, plant: material.plant, quantity, unit: material.unit, raisedAt: at });
  })
);

// --- Where the goods are -------------------------------------------------------

// POST /api/shipments/:id/advance   { stage?, note? }
//
// Moves a released order one step along. `stage` is optional and is checked rather than
// obeyed: sending it lets a stale screen say which move it thought it was making, and the
// rule refuses if that is no longer the next one. Without it the order simply advances.
//
// Nothing is mailed. Every other action here tells somebody something; this one records
// what a vendor or a gate clerk has already done, and the people who would be told are
// the ones who told us.
actionsRouter.post(
  '/shipments/:id/advance',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const documents = await getDocuments();
    const document = documents.find((d) => d.id === req.params.id);
    if (!document) {
      return res.status(404).json({ error: `No document found with the number ${req.params.id}.` });
    }

    const wanted = String(req.body?.stage || '').trim();
    const verdict = canAdvanceTo(document, wanted || null);
    if (!verdict.ok) {
      return res.status(409).json({ error: verdict.why });
    }

    const at = stamp();
    const note = String(req.body?.note || '').trim();

    await store.saveShipmentStage({
      documentId: document.id,
      document,
      stage: verdict.stage.key,
      at,
      note,
      actionLabel: verdict.stage.label.toLowerCase(),
      recordedBy: req.user.name,
      recordedByAddress: req.user.username
    });

    res.json({
      id: document.id,
      stage: verdict.stage.key,
      label: verdict.stage.label,
      describe: verdict.stage.describe,
      at,
      complete: verdict.stage.key === LAST_STAGE
    });
  })
);

// POST /api/shipments/:id/tracking   { trackingId }
//
// The number the vendor sent back when they dispatched. Recording it also moves the order
// on, because a vendor handing over a tracking number IS the dispatch - waiting for a
// separate click to say so would be recording the same event twice.
//
// It is stored as given. No format is imposed: every carrier numbers differently, and a
// dashboard that rejected a real number because it did not match a pattern would be wrong
// in the one way that matters.
actionsRouter.post(
  '/shipments/:id/tracking',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const documents = await getDocuments();
    const document = documents.find((d) => d.id === req.params.id);
    if (!document) {
      return res.status(404).json({ error: `No document found with the number ${req.params.id}.` });
    }

    const trackingId = String(req.body?.trackingId || '').trim();
    if (!trackingId) {
      return res.status(400).json({ error: 'Enter the tracking number the vendor sent back.' });
    }
    if (trackingId.length > 60) {
      return res.status(400).json({ error: 'That is longer than any tracking number.' });
    }

    if (!isTrackable(document)) {
      return res.status(409).json({ error: `${document.id} has not been released yet.` });
    }

    const at = stamp();
    await store.saveTrackingId({
      documentId: document.id,
      document,
      trackingId,
      at,
      recordedBy: req.user.name,
      recordedByAddress: req.user.username
    });

    // Move it to dispatched if it is not there yet. One step at a time, as always.
    const verdict = canAdvanceTo(document, null);
    let stage = currentStage(document);
    if (verdict.ok && verdict.stage.key === 'dispatched') {
      await store.saveShipmentStage({
        documentId: document.id,
        document,
        stage: verdict.stage.key,
        at,
        note: `Tracking number ${trackingId} from the vendor`,
        actionLabel: verdict.stage.label.toLowerCase(),
        recordedBy: req.user.name,
        recordedByAddress: req.user.username
      });
      stage = verdict.stage.key;
    }

    res.json({ id: document.id, trackingId, at, stage });
  })
);

// POST /api/shipments/:id/arrive   { note }
//
// Confirms the consignment is at the gate, recording every stage between where it was and
// there rather than jumping.
//
// Jumping would be easier and would be a lie: "delivered" on an order with no dispatch
// behind it is how goods get booked in that nobody ever saw leave. So the steps are
// written one at a time, each with its own time, and the ones inferred from the carrier
// say so in their note rather than pretending somebody watched them.
actionsRouter.post(
  '/shipments/:id/arrive',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    let documents = await getDocuments();
    let document = documents.find((d) => d.id === req.params.id);
    if (!document) {
      return res.status(404).json({ error: `No document found with the number ${req.params.id}.` });
    }
    if (!document.trackingId) {
      return res.status(409).json({ error: `${document.id} has no tracking number, so there is nothing to confirm.` });
    }

    const note = String(req.body?.note || '').trim();
    const recorded = [];

    // Walk forwards to "delivered" and no further. Booking it into stock stays a separate
    // decision, because that is the one that puts the material on the books.
    for (let step = 0; step < STAGE_COUNT; step++) {
      const verdict = canAdvanceTo(document, null);
      if (!verdict.ok || currentStage(document) === 'delivered') break;

      const at = stamp();
      await store.saveShipmentStage({
        documentId: document.id,
        document,
        stage: verdict.stage.key,
        at,
        note:
          verdict.stage.key === 'delivered'
            ? note || `Confirmed at the gate against ${document.trackingId}`
            : `From the carrier feed for ${document.trackingId}`,
        actionLabel: verdict.stage.label.toLowerCase(),
        recordedBy: req.user.name,
        recordedByAddress: req.user.username
      });
      recorded.push(verdict.stage.key);

      documents = await getDocuments();
      document = documents.find((d) => d.id === req.params.id);
      if (currentStage(document) === 'delivered') break;
    }

    if (recorded.length === 0) {
      return res.status(409).json({ error: `${document.id} is already at ${currentStage(document)}.` });
    }

    res.json({ id: document.id, recorded, stage: currentStage(document) });
  })
);

// --- Ask -----------------------------------------------------------------------

// POST /api/ask   { question, plant }
//
// Answers a question, or offers to do something. It never does it.
//
// A proposal comes back describing the action in words plus the ordinary endpoint that
// would carry it out - the same one the buttons use. The browser shows it, the person
// confirms, and the confirm is an ordinary authenticated request like any other. Ask has
// no private way into the store, so the worst a misread question can cost is a click.
//
// This is a POST rather than a GET because the question is a body, and because a URL that
// reads "?question=approve 4500178401" is the kind of thing that ends up in a log, a
// browser history and a bookmark.
actionsRouter.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    const plant = String(req.body?.plant || 'all').trim();
    // What was being talked about a moment ago, sent back by the browser.
    //
    // Held there rather than here on purpose: the server stays stateless, two people
    // cannot end up sharing a train of thought, and nothing has to be expired. It carries
    // no authority - only which material or document was last named - so a browser that
    // tampers with it can at most confuse itself.
    const memory = req.body?.memory && typeof req.body.memory === 'object' ? req.body.memory : {};

    if (question.length > 500) {
      return res.status(400).json({ error: 'That is longer than I can read. Ask me something shorter.' });
    }

    const [documents, materials, vendors] = await Promise.all([
      getDocuments(),
      getStock(),
      getSupplierScores()
    ]);

    // Filtered the same way the screens are, so an answer matches what is on them.
    const inPlant = (rows) => (plant === 'all' ? rows : rows.filter((r) => !r.plant || r.plant === plant));

    const result = readIntent(question, {
      documents: inPlant(documents),
      materials: inPlant(materials),
      vendors: Object.values(vendors),
      plant,
      manager: req.user.name,
      memory
    });

    // A proposal that would write anything is refused outright against a read-only source,
    // rather than offered and failing at the confirm - which would read as the dashboard
    // changing its mind.
    if (result.kind === 'proposal' && !store.canWrite()) {
      return res.json({
        kind: 'answer',
        text:
          `I can tell you about ${result.summary.toLowerCase()}, but nothing can be saved with ` +
          `DATA_SOURCE="${config.dataSource}". Set it to "excel" or "db" and restart the backend.`
      });
    }

    res.json(result);
  })
);

// --- Writing a mail ----------------------------------------------------------

// POST /api/mail   { toName, to, subject, body }
//
// Two ways to say who it goes to, and the order matters.
//
// `toName` is a person named on the dashboard, and their address is looked up HERE. The
// browser is never told what it is. That is the whole reason this lookup is on the server:
// the directory holds real people's personal mailboxes, and anything sent to a browser is
// readable by anyone holding that browser.
//
// `to` is an address the person at the keyboard typed themselves. That is theirs to decide,
// so it is accepted as given, and it wins if both are present.
actionsRouter.post(
  '/mail',
  asyncHandler(async (req, res) => {
    const typed = String(req.body?.to || '').trim();
    const toName = String(req.body?.toName || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();

    const resolved = typed ? { address: typed, real: true, name: '' } : recipientFor(toName);

    // Somebody with no mailbox on file resolves to no address at all, rather than to a
    // guess. The message still goes out, to the operator, saying at the top who it was for.
    // Refusing to send would lose what they wrote; guessing an address would bounce it.
    const to = resolved.address || config.mail.to || config.mail.user;
    const redirected = Boolean(resolved.name) && !resolved.real;

    if (!to || !subject) {
      return res.status(400).json({ error: 'A mail needs at least a recipient and a subject.' });
    }

    const mail = await sendPlainEmail({
      to,
      subject,
      body: redirected
        ? `[Meant for ${resolved.name}. There is no mailbox on file for them, so this came ` +
          `to you instead. Add them to MAIL_DIRECTORY in .env to have it delivered.]\n\n${body}`
        : body,
      from: req.user.username
    });

    await store
      .saveMail({ to, subject, body, sentAt: stamp(), sentBy: req.user.name, sentByAddress: req.user.username, mail })
      .catch((error) => console.error('[api] mail sent but not logged:', error.message));

    // The address is deliberately not returned. The screen says who it went to by name, and
    // sending it back here would put the directory into the browser through the back door -
    // the exact thing moving the lookup was meant to stop.
    //
    // `deliverable` is what the screen actually needs: whether that person has a real
    // mailbox on file, or whether this one is going to bounce.
    res.json({ ...mail, to: undefined, deliverable: resolved.real, toName: resolved.name || undefined });
  })
);

// --- Looking up one address, on demand ---------------------------------------

// GET /api/contact/address?name=Mr.%20Anil%20Deshmukh
//
// Answers "where would a mail to this person go", for the To box of the compose window.
//
// One name per request, when somebody opens the window, rather than the whole directory
// riding along inside /api/dashboard. The difference is what ends up copied: the dashboard
// payload is held in the page for the whole session and is what the shareable offline file
// is built from, so an address in there is an address in both. This one exists for as long
// as the compose window is open, and only for the person being written to.
actionsRouter.get(
  '/contact/address',
  asyncHandler(async (req, res) => {
    const person = recipientFor(String(req.query.name || ''));
    res.json({ name: person.name, address: person.address, deliverable: person.real });
  })
);

// --- Reaching somebody on Teams ----------------------------------------------

// GET /api/contact/teams?name=Mr.%20Anil%20Deshmukh&mode=chat|call
//
// Redirects to a Microsoft Teams deep link for that person. It is a redirect rather than a
// link the browser builds itself for the same reason everything else here is: the deep link
// has to carry an address, and building it in the page would put the whole directory back
// into the bundle and into the shareable offline copy.
//
// This way the address exists only in the Location header of one response, sent when
// somebody actually clicks. Nothing is stored in the page.
actionsRouter.get(
  '/contact/teams',
  asyncHandler(async (req, res) => {
    const person = recipientFor(String(req.query.name || ''));
    const mode = req.query.mode === 'call' ? 'call' : 'chat';

    if (!person.address) {
      return res.status(404).json({
        error: `There is no mailbox on file for ${person.name || 'that person'}, so Teams has nobody to open. Add them to MAIL_DIRECTORY in .env.`
      });
    }

    const link =
      mode === 'call'
        ? `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(person.address)}`
        : `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(person.address)}`;

    // 302 rather than 301: which mailbox a name maps to is a setting, and a permanent
    // redirect would be cached by the browser long after that setting changed.
    res.redirect(302, link);
  })
);

// --- The audit trail ---------------------------------------------------------

// GET /api/action-log
//
// The stored log keeps the exact address every mail went to, which is what an audit trail is
// for. This response does not, because it has two readers that the workbook does not: the
// browser, and the offline HTML file, which bakes whatever this returns into a document
// people pass around. A colleague's personal mailbox does not belong in either.
//
// So the address is masked on the way out. The full record stays on the server for anyone
// who needs to answer "where exactly did that go".
actionsRouter.get(
  '/action-log',
  asyncHandler(async (req, res) => {
    const entries = (await store.readActionLog()).map((entry) => ({
      ...entry,
      emailTo: maskedAddress(entry.emailTo)
    }));
    res.json({ entries, available: store.canWrite() });
  })
);

