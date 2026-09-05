// The Today screen, the situations list and the record of this morning's run.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getToday, getSituations, getAgentRun } from '../data-service.js';

export const todayRouter = Router();

// GET /api/today - summary line, three decisions, headline numbers
todayRouter.get(
  '/today',
  asyncHandler(async (req, res) => {
    res.json(await getToday());
  })
);

// GET /api/situations - problems found, each with its cause and a proposed fix
todayRouter.get(
  '/situations',
  asyncHandler(async (req, res) => {
    const situations = await getSituations();
    res.json({
      situations,
      // Honest labelling: none of this comes from a real system.
      simulated: true
    });
  })
);

// GET /api/agent-activity - what the scheduled morning run did, and the savings basis
todayRouter.get(
  '/agent-activity',
  asyncHandler(async (req, res) => {
    const run = await getAgentRun();
    res.json({ run, simulated: true });
  })
);
