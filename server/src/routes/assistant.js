// The assistant's own routes.
//
// New routes, not changes to old ones. Nothing here touches /api/dashboard, /api/approvals,
// /api/shipments or /api/mail - the screens that were working this morning are working on
// exactly the code they were.
//
// Everything is behind the same sign-in as the rest of the API, because a conversation that
// can read the order book and send mail is not less sensitive than the order book.

import { Router } from 'express';

import { asyncHandler } from './helpers.js';
import { getEverything } from '../data-service.js';
import { config } from '../config.js';
import { ask, confirm, openers, resetSession, assistantConfigured } from '../ai/assistant.js';
import { readFlags } from '../ai/actions.js';

export const assistantRouter = Router();

// Everything the tools are allowed to see, plus who is asking.
//
// Rebuilt per request rather than held between them. The workbook is the live store and a
// person approves things while the panel is open; a conversation answering from a snapshot
// taken when it opened would confidently describe a document somebody had just released.
async function contextFor(req) {
  const data = await getEverything();
  return {
    documents: data.documents,
    materials: data.materials,
    vendors: data.suppliers,
    manager: req.user?.name || 'the approver'
  };
}

// One conversation per signed-in person. Opening a second tab continues the same thread,
// which is what somebody expects from something calling itself a conversation.
function sessionIdFor(req) {
  return `user:${req.user?.username || 'anonymous'}`;
}

// GET /api/assistant/status
//
// Whether there is a key. The browser asks first so it can fall back to the built-in
// parser quietly, rather than offering a chat box that errors on the first question.
assistantRouter.get('/assistant/status', (req, res) => {
  res.json({
    available: assistantConfigured(),
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    mailEnabled: config.mail.enabled
  });
});

// GET /api/assistant/openers
assistantRouter.get(
  '/assistant/openers',
  asyncHandler(async (req, res) => {
    const context = await contextFor(req);
    res.json({ openers: openers(context) });
  })
);

// GET /api/assistant/flags
assistantRouter.get(
  '/assistant/flags',
  asyncHandler(async (req, res) => {
    res.json({ flags: await readFlags() });
  })
);

// POST /api/assistant/ask   { question, filter }
assistantRouter.post(
  '/assistant/ask',
  asyncHandler(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) {
      res.status(400).json({ error: 'Ask me something.' });
      return;
    }

    if (!assistantConfigured()) {
      res.status(503).json({
        error: 'The assistant is not switched on. Set GEMINI_API_KEY in .env and restart the backend.',
        available: false
      });
      return;
    }

    const context = await contextFor(req);
    const result = await ask({
      sessionId: sessionIdFor(req),
      question,
      filter: req.body?.filter || {},
      context
    });

    res.json(result);
  })
);

// POST /api/assistant/confirm   { approved }
//
// The only way an action ever runs. The browser cannot name the action or its arguments -
// it can only say yes or no to the one the server is already holding, so a page with
// something nasty injected into it still cannot choose what happens.
assistantRouter.post(
  '/assistant/confirm',
  asyncHandler(async (req, res) => {
    const context = await contextFor(req);
    const result = await confirm({
      sessionId: sessionIdFor(req),
      approved: req.body?.approved !== false,
      context
    });

    res.json(result);
  })
);

// POST /api/assistant/reset
assistantRouter.post('/assistant/reset', (req, res) => {
  resetSession(sessionIdFor(req));
  res.json({ cleared: true });
});
