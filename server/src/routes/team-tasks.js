// Giving somebody a task, and following it afterwards.
//
// New routes. Nothing here touches the document, shipment or mail routes - the board these
// feed shows derived work alongside assigned work, but only this half is stored, and only
// this half can be changed from here.

import { Router } from 'express';

import { asyncHandler } from './helpers.js';
import { listTasks, addTask, updateTask, removeTask, STATUSES } from '../team-tasks.js';

export const teamTasksRouter = Router();

// GET /api/team-tasks
teamTasksRouter.get(
  '/team-tasks',
  asyncHandler(async (req, res) => {
    res.json({ tasks: await listTasks(), statuses: STATUSES });
  })
);

// POST /api/team-tasks   { title, detail, assignedTo, teamId, kpi, plant, due }
teamTasksRouter.post(
  '/team-tasks',
  asyncHandler(async (req, res) => {
    // Who gave it out is taken from the session, never from the browser. A task is a record
    // of somebody asking for something, and the one field that must not be forgeable is
    // which somebody.
    const task = await addTask(req.body || {}, req.user?.name || req.user?.username || 'the approver');
    res.status(201).json({ task });
  })
);

// PATCH /api/team-tasks/:id   { status | title | detail | assignedTo | ... }
teamTasksRouter.patch(
  '/team-tasks/:id',
  asyncHandler(async (req, res) => {
    res.json({ task: await updateTask(req.params.id, req.body || {}) });
  })
);

// DELETE /api/team-tasks/:id
teamTasksRouter.delete(
  '/team-tasks/:id',
  asyncHandler(async (req, res) => {
    res.json(await removeTask(req.params.id));
  })
);
