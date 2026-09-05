// A "route" is a URL the backend answers on. This one exists so you can prove the
// backend is alive and correctly configured before debugging anything more complicated.
// It is the first thing to check whenever the dashboard looks wrong.

import { Router } from 'express';
import { config, hasSapKey } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'procurement-dashboard-api',
    dataSource: config.dataSource,
    // true/false only. The key itself must never leave the server.
    sapKeyLoaded: hasSapKey,
    checkedAt: new Date().toISOString()
  });
});
