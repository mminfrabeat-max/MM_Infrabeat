// Tasks somebody typed in and gave to a person.
//
// Everything else on the team board is worked out from the documents - a requisition
// waiting, an order never raised - and needs no storage, because the document is the record.
// This is the other kind: "ring Bharat Bearings about the bearing delivery", which no
// document knows about and which therefore has to be kept somewhere.
//
// A file of its own, next to the review flags, for the same reason. It is not SAP data and
// does not belong in the workbook that mirrors SAP: a spreadsheet row that means "a person
// at this company promised to do this" would be indistinguishable, a year from now, from a
// row that came out of the system of record.
//
// Small enough to read and rewrite whole. A procurement desk does not generate the kind of
// volume that needs anything cleverer, and a file you can open and read in a text editor is
// worth a great deal when somebody asks why a task disappeared.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '../data/team-tasks.json');

export const STATUSES = ['open', 'in progress', 'blocked', 'done'];

async function readAll() {
  try {
    const text = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (problem) {
    // No file yet is the ordinary state before anybody has been given anything.
    if (problem.code === 'ENOENT') return [];
    throw problem;
  }
}

async function writeAll(tasks) {
  await fs.writeFile(file, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
}

export async function listTasks() {
  return readAll();
}

// Enough of a key to be unique without pulling in a library for it.
function newId() {
  return `TT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export async function addTask(fields, by) {
  const title = String(fields.title || '').trim();
  if (!title) throw Object.assign(new Error('A task needs a title.'), { status: 400 });

  const assignedTo = String(fields.assignedTo || '').trim();
  if (!assignedTo) throw Object.assign(new Error('A task needs somebody to do it.'), { status: 400 });

  const task = {
    id: newId(),
    title,
    detail: String(fields.detail || '').trim(),
    assignedTo,
    // Which manager's card it appears under. Sent by the browser because it knows the
    // roster it drew the list from, and re-deriving it here would mean a second copy of
    // the same lookup that could disagree with the first.
    teamId: String(fields.teamId || '').trim(),
    kpi: String(fields.kpi || 'other').trim(),
    plant: String(fields.plant || '').trim(),
    due: String(fields.due || '').trim(),
    status: STATUSES.includes(fields.status) ? fields.status : 'open',
    createdBy: by,
    createdAt: new Date().toISOString(),
    doneAt: null
  };

  const tasks = await readAll();
  tasks.unshift(task);
  await writeAll(tasks);
  return task;
}

export async function updateTask(id, changes) {
  const tasks = await readAll();
  const task = tasks.find((t) => t.id === id);
  if (!task) throw Object.assign(new Error(`There is no task ${id}.`), { status: 404 });

  if (changes.status !== undefined) {
    if (!STATUSES.includes(changes.status)) {
      throw Object.assign(new Error(`${changes.status} is not a status a task can be in.`), { status: 400 });
    }
    task.status = changes.status;
    // Stamped when it is finished, and cleared if it is reopened - so a task that comes
    // back does not keep a completion date it no longer deserves.
    task.doneAt = changes.status === 'done' ? new Date().toISOString() : null;
  }

  for (const field of ['title', 'detail', 'assignedTo', 'teamId', 'kpi', 'plant', 'due']) {
    if (changes[field] !== undefined) task[field] = String(changes[field]).trim();
  }

  await writeAll(tasks);
  return task;
}

export async function removeTask(id) {
  const tasks = await readAll();
  const left = tasks.filter((t) => t.id !== id);
  if (left.length === tasks.length) {
    throw Object.assign(new Error(`There is no task ${id}.`), { status: 404 });
  }
  await writeAll(left);
  return { removed: id };
}
