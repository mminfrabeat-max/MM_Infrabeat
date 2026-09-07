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
import { sendDecisionEmail, sendPlainEmail } from '../mailer.js';
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

// --- Approve and send back ---------------------------------------------------

async function decide(req, res, action) {
  if (!requireWritableSource(res)) return;

  const documentId = req.params.id;
  const note = String(req.body?.note || '').trim();
  // Taken from the signed-in session, never from the request body. If the browser could
  // tell us who approved something, anyone could approve as anyone.
  const decidedBy = req.user.username;

  const documents = await getDocuments();
  const document = documents.find((d) => d.id === documentId);

  if (!document) {
    return res.status(404).json({ error: `No document found with the number ${documentId}.` });
  }

  // Guards against a double click, a stale browser tab, or two people acting at once.
  if (document.status !== 'pending') {
    return res.status(409).json({
      error: `${documentId} was already ${document.status}${
        document.decidedBy ? ` by ${document.decidedBy}` : ''
      }. Refresh to see the current position.`
    });
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  const at = stamp();

  // The email is attempted before the save so its outcome can be recorded in the same
  // transaction. A failure here is returned as a status string, never thrown, so it cannot
  // stop the decision being saved a moment later.
  const mail = await sendDecisionEmail({ document, decision: status, decidedBy, note });

  await store.saveDecision({ documentId, status, decidedBy, decidedAt: at, note, document, mail });

  res.json({ status, documentId, decidedBy, decidedAt: at, saved: true, email: mail });
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
      fixedBy: req.user.username
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
      raisedBy: req.user.username
    });

    res.json({ code: material.code, plant: material.plant, quantity, unit: material.unit, raisedAt: at });
  })
);

// --- Writing a mail ----------------------------------------------------------

// POST /api/mail   { to, subject, body }
actionsRouter.post(
  '/mail',
  asyncHandler(async (req, res) => {
    const to = String(req.body?.to || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();

    if (!to || !subject) {
      return res.status(400).json({ error: 'A mail needs at least an address and a subject.' });
    }

    const mail = await sendPlainEmail({ to, subject, body, from: req.user.username });

    await store
      .saveMail({ to, subject, body, sentAt: stamp(), sentBy: req.user.username, mail })
      .catch((error) => console.error('[api] mail sent but not logged:', error.message));

    res.json(mail);
  })
);

// --- The audit trail ---------------------------------------------------------

// GET /api/action-log
actionsRouter.get(
  '/action-log',
  asyncHandler(async (req, res) => {
    res.json({ entries: await store.readActionLog(), available: store.canWrite() });
  })
);
