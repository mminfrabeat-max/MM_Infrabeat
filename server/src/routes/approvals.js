// Everything waiting for a decision, and the detail view for one document.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getDocuments } from '../data-service.js';

export const approvalsRouter = Router();

// GET /api/approvals - the full list, longest wait first
approvalsRouter.get(
  '/approvals',
  asyncHandler(async (req, res) => {
    const documents = await getDocuments();
    res.json({ documents });
  })
);

// GET /api/approvals/:id - one document with its supplier's ten-order history
//
// The :id part is a "route parameter": whatever the browser puts there arrives as
// req.params.id. So /api/approvals/4500178401 gives id = "4500178401".
approvalsRouter.get(
  '/approvals/:id',
  asyncHandler(async (req, res) => {
    const documents = await getDocuments();
    const document = documents.find((d) => d.id === req.params.id);

    // A missing document is a normal outcome, not a crash. Answer with 404 and a
    // sentence the screen can show, rather than letting it fall through to the
    // generic error handler.
    if (!document) {
      return res.status(404).json({
        error: `No document found with the number ${req.params.id}.`
      });
    }

    res.json({ document });
  })
);

// POST /api/approvals/:id/approve and /reject arrive in milestone 5.
// They are deliberately absent rather than half-built: an approve button that silently
// does nothing is worse than one that says it is not ready.
