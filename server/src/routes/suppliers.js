// Supplier reliability, scored from each supplier's last ten orders.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getSupplierScores, getDocuments } from '../data-service.js';

export const suppliersRouter = Router();

// GET /api/suppliers - every supplier with its score, trend and ten-order history
suppliersRouter.get(
  '/suppliers',
  asyncHandler(async (req, res) => {
    const [scoresById, documents] = await Promise.all([
      getSupplierScores(),
      getDocuments()
    ]);

    // Count how many documents are waiting on each supplier, so the screen can say
    // "and there are two orders with them right now" - which is what turns a score
    // into something worth acting on.
    const suppliers = Object.values(scoresById).map((score) => ({
      ...score,
      openDocumentCount: documents.filter(
        (d) => d.supplierId === score.supplierId && d.status === 'pending'
      ).length
    }));

    // Worst first: the ones needing attention should not be at the bottom of the page.
    suppliers.sort((a, b) => a.total - b.total);

    res.json({
      suppliers,
      // The ten-order delivery and quality history does not exist in the SAP sandbox.
      historySimulated: true
    });
  })
);
