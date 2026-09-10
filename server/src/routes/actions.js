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
import { getDocuments, getSituations, getStock } from '../data-service.js';
import * as store from '../store.js';
import { sendDecisionEmail, sendInitiatorEmail, sendPlainEmail } from '../mailer.js';
import { canDecide, outcomeOf, outcomeSentence } from '../domain/approvals.js';
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
  // Taken from the signed-in session, never from the request body. If the browser could
  // tell us who approved something, anyone could approve as anyone.
  const decidedBy = req.user.name;
  // Kept separately because a mail has to be routable: this is what a reply goes to.
  const decidedByAddress = req.user.username;

  const documents = await getDocuments();
  const document = documents.find((d) => d.id === documentId);

  if (!document) {
    return res.status(404).json({ error: `No document found with the number ${documentId}.` });
  }

  // Guards against a double click, a stale browser tab, or two people acting at once.
  //
  // A document can be pending and still not be theirs to act on: they approved it and it
  // moved to the next person. That case has to say so, because "already approved" on a
  // screen that still shows Approve is the sort of message people file a ticket about.
  if (!canDecide(document)) {
    const alreadyMoved = document.status === 'pending' && document.decidedAt;
    return res.status(409).json({
      error: alreadyMoved
        ? `You approved ${documentId} at ${document.decidedAt}. It is now with ${
            document.next?.name || 'the next approver'
          } and is no longer yours to act on. Refresh to see the current position.`
        : `${documentId} was already ${document.status}${
            document.decidedBy ? ` by ${document.decidedBy}` : ''
          }. Refresh to see the current position.`
    });
  }

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

  res.json({
    status: outcome.status,
    final: outcome.final,
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

