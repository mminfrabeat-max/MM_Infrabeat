// One route that returns the whole picture.
//
// Seven separate calls would mean seven chances to show half a page, and the plant selector
// at the top re-filters every screen at once, so the browser needs everything in hand
// anyway. The payload is a few tens of kilobytes, which is nothing next to a round trip
// per tab change.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getEverything } from '../data-service.js';
import { config } from '../config.js';
import { canWrite } from '../store.js';

export const dashboardRouter = Router();

// GET /api/dashboard
dashboardRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const data = await getEverything();
    res.json({
      ...data,
      // Who is signed in, so the screen can greet them and stamp their decisions.
      user: { email: req.user.username, name: req.user.name },
      // Whether decisions can actually be saved. True for the database and the workbook,
      // false for the read-only JSON and the SAP sandbox.
      canDecide: canWrite(),
      dataSource: config.dataSource
    });
  })
);
