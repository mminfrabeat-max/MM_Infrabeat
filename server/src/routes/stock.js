// Materials, days of cover, and what runs out before a delivery could arrive.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getStock } from '../data-service.js';

export const stockRouter = Router();

// GET /api/stock - every material, most urgent first
stockRouter.get(
  '/stock',
  asyncHandler(async (req, res) => {
    const materials = await getStock();
    res.json({
      materials,
      atRiskCount: materials.filter((m) => m.willRunOut).length,
      belowReorderCount: materials.filter((m) => m.belowReorderPoint).length
    });
  })
);
