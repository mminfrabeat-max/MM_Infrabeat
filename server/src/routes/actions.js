// Everything the manager can actually DO: approve, send back, clear a problem, raise a
// request, and write a mail.
//
// One rule runs through all of them, and the order of operations enforces it:
//
//   1. Write the change to the workbook
//   2. Then try to send the email
//   3. Then write one audit line, once the email outcome is known
//
// Saving first means a mail failure can never lose a decision. The reverse order could
// leave you having emailed a vendor about an approval that was never recorded, which is
// much the worse of the two failures.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getDocuments, getSituations, getStock } from '../data-service.js';
import {
  updateDocument,
  updateSituation,
  updateMaterial,
  appendActionLog,
  readActionLog
} from '../excel-store.js';
import { sendDecisionEmail, sendPlainEmail } from '../mailer.js';
import { config } from '../config.js';
import { totalValue } from '../domain/documents.js';

export const actionsRouter = Router();

// Decisions can only be written to the workbook. With DATA_SOURCE=mock the JSON files are
// read-only demo data, so say that plainly rather than pretending it worked.
function requireWritableSource(res) {
  if (config.dataSource !== 'excel') {
    res.status(409).json({
      error:
        'Changes can only be saved when the data source is the Excel workbook. ' +
        'Set DATA_SOURCE=excel in your .env and restart the backend.'
    });
    return false;
  }
  return true;
}

function stamp() {
  return new Date().toLocaleString('en-IN');
}

// --- Approve and send back ---------------------------------------------------

async function decide(req, res, decision) {
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

  const status = decision === 'approve' ? 'approved' : 'rejected';
  const at = stamp();

  // Step 1: save. If the workbook is open in Excel this throws, and the error handler in
  // index.js turns it into "close it and try again" on screen.
  await updateDocument(documentId, { status, decidedBy, decidedAt: at, decisionNote: note });

  // Step 2: email. A failure here is reported, never thrown.
  const mail = await sendDecisionEmail({ document, decision: status, decidedBy, note });

  // Step 3: one audit line, now the outcome is known.
  await appendActionLog({
    at,
    action: status,
    documentId,
    documentType: document.kind,
    supplierName: document.supplierName,
    value: totalValue(document),
    decidedBy,
    note,
    emailTo: mail.to,
    emailStatus: mail.status
  }).catch((error) => console.error('[api] decision saved but not logged:', error.message));

  res.json({ status, documentId, decidedBy, decidedAt: at, savedToWorkbook: true, email: mail });
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

    if (!situation) return res.status(404).json({ error: `No problem found with reference ${req.params.id}.` });
    if (situation.status !== 'open') {
      return res.status(409).json({ error: `${situation.id} has already been handled.` });
    }

    const at = stamp();
    await updateSituation(situation.id, { status: 'fixed' });

    await appendActionLog({
      at,
      action: 'problem fixed',
      documentId: situation.id,
      documentType: '',
      supplierName: situation.relatedTo,
      value: '',
      decidedBy: req.user.username,
      note: situation.fix,
      emailTo: '',
      emailStatus: ''
    }).catch(() => {});

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

    // Adding to the quantity on order is what a raised request actually changes: the
    // material is no longer short once the buyer places it.
    await updateMaterial(material.code, material.plant, {
      openOrderQuantity: material.openOrderQuantity + quantity
    });

    await appendActionLog({
      at,
      action: 'request raised',
      documentId: material.code,
      documentType: '',
      supplierName: material.supplierName,
      value: '',
      decidedBy: req.user.username,
      note: `${quantity} ${material.unit} of ${material.name} at ${material.plant}`,
      emailTo: '',
      emailStatus: ''
    }).catch(() => {});

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

    // Logged whether it went or not, so there is a record of the attempt either way.
    if (config.dataSource === 'excel') {
      await appendActionLog({
        at: stamp(),
        action: 'mail sent',
        documentId: '',
        documentType: '',
        supplierName: '',
        value: '',
        decidedBy: req.user.username,
        note: subject,
        emailTo: to,
        emailStatus: mail.status
      }).catch(() => {});
    }

    res.json(mail);
  })
);

// --- The audit trail ---------------------------------------------------------

// GET /api/action-log
actionsRouter.get(
  '/action-log',
  asyncHandler(async (req, res) => {
    if (config.dataSource !== 'excel') return res.json({ entries: [], available: false });
    res.json({ entries: await readActionLog(), available: true });
  })
);
