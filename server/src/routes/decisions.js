// Approving and rejecting a document.
//
// The order of operations here is the important part, and it is deliberate:
//
//   1. Check the document exists and is still waiting
//   2. Write the decision to the workbook
//   3. Then try to send the email
//
// Saving first means a mail failure can never lose an approval. The reverse order would
// mean a slow mail server could leave you having emailed a supplier about an approval
// that was never recorded, which is the worse of the two failures by a long way.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getDocuments } from '../data-service.js';
import { updateDocument, appendActionLog, readActionLog } from '../excel-store.js';
import { sendDecisionEmail } from '../mailer.js';
import { config } from '../config.js';

export const decisionsRouter = Router();

async function decide(req, res, decision) {
  const documentId = req.params.id;
  const note = String(req.body?.note || '').trim();
  // Taken from the signed-in session, never from the request body. If the browser could
  // tell us who approved something, anyone could approve as anyone.
  const decidedBy = req.user.username;

  // Decisions can only be written to the workbook. With DATA_SOURCE=mock the JSON files
  // are read-only demo data, so say that plainly rather than pretending it worked.
  if (config.dataSource !== 'excel') {
    return res.status(409).json({
      error:
        'Decisions can only be saved when the data source is the Excel workbook. ' +
        'Set DATA_SOURCE=excel in your .env and restart the backend.'
    });
  }

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

  const decidedAt = new Date();
  const status = decision === 'approve' ? 'approved' : 'rejected';

  // --- Step 1: save the decision. This must succeed before anything else happens.
  // If the workbook is open in Excel this throws, and the error handler in index.js
  // turns it into "close it and try again" on screen.
  await updateDocument(documentId, {
    status,
    decidedBy,
    decidedAt: decidedAt.toLocaleString('en-IN'),
    decisionNote: note
  });

  // --- Step 2: try the email. A failure here is reported, never thrown, because the
  // decision above is already saved and must not be undone by a mail problem.
  const mail = await sendDecisionEmail({
    document,
    decision: status,
    decidedBy,
    note
  });

  // --- Step 3: write one audit line, now that the email outcome is known.
  // Wrapped so that a failure to log cannot fail a decision that already succeeded.
  await appendActionLog({
    at: decidedAt.toLocaleString('en-IN'),
    action: status,
    documentId,
    documentType: document.type,
    supplierName: document.supplierName,
    value: document.value,
    decidedBy,
    note,
    emailTo: mail.to,
    emailStatus: mail.status
  }).catch((error) => {
    console.error('[api] decision saved but could not be logged:', error.message);
  });

  res.json({
    status,
    documentId,
    decidedBy,
    decidedAt: decidedAt.toISOString(),
    savedToWorkbook: true,
    email: mail
  });
}

// POST /api/approvals/:id/approve   { note }
decisionsRouter.post(
  '/approvals/:id/approve',
  asyncHandler((req, res) => decide(req, res, 'approve'))
);

// POST /api/approvals/:id/reject    { note }
decisionsRouter.post(
  '/approvals/:id/reject',
  asyncHandler((req, res) => decide(req, res, 'reject'))
);

// GET /api/action-log - every decision made, newest first
decisionsRouter.get(
  '/action-log',
  asyncHandler(async (req, res) => {
    if (config.dataSource !== 'excel') {
      return res.json({ entries: [], available: false });
    }
    res.json({ entries: await readActionLog(), available: true });
  })
);
