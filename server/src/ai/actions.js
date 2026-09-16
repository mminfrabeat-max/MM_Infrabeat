// Carrying out the three things the assistant can change, once somebody has confirmed it.
//
// Nothing in this file runs when the model asks for it. It runs when a person has read a
// sentence describing it and pressed a button. That ordering is the whole safety design,
// and it is enforced in the route, not here - so treat everything below as already
// authorised and get on with doing it properly.
//
// Each returns { done, message, ... } and the message is written to be read twice: once by
// the person, and once by the model, which is told the outcome so it does not claim
// something happened that did not.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { sendPlainEmail, mailConfigured } from '../mailer.js';
import { recipientFor, maskedAddress } from '../domain/recipients.js';
import { money as inr } from '../domain/format.js';
import { dmy } from './tools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFolder = path.resolve(here, '../../data');
const flagFile = path.join(dataFolder, 'review-flags.json');

// --- Flags ---------------------------------------------------------------------
//
// A small file of its own rather than a column on the workbook. A flag is the person's own
// note to themselves - it is not an SAP field, it does not belong in a sheet that mirrors
// one, and keeping it separate means turning the feature off is deleting one file.

export async function readFlags() {
  try {
    const text = await fs.readFile(flagFile, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (problem) {
    // A missing file is the ordinary state before anything has ever been flagged.
    if (problem.code === 'ENOENT') return [];
    throw problem;
  }
}

async function writeFlags(flags) {
  await fs.writeFile(flagFile, `${JSON.stringify(flags, null, 2)}\n`, 'utf8');
}

// --- Exports -------------------------------------------------------------------

const EXPORTS = {
  pending: {
    title: 'Awaiting approval',
    rows(context) {
      return context.documents
        .filter((d) => d.status === 'pending')
        .sort((a, b) => (b.hoursWaiting || 0) - (a.hoursWaiting || 0));
    }
  },
  late: {
    title: 'Past the delivery date',
    rows(context) {
      return context.documents.filter((d) => d.priority?.overdue);
    }
  },
  all: {
    title: 'Every document',
    rows(context) {
      return context.documents;
    }
  }
};

// One CSV cell. Quoted whenever it holds anything that would otherwise split the row, and
// doubled quotes inside, which is the whole of the CSV escaping rule.
function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}

function documentsToCsv(rows) {
  const header = [
    'Document',
    'Type',
    'Material',
    'Vendor',
    'Plant',
    'Quantity',
    'Unit',
    'Value (INR)',
    'Delivery date',
    'Approval status',
    'Held by',
    'Days waiting',
    'Priority',
    'Shipment'
  ];

  const body = rows.map((d) =>
    [
      d.id,
      d.kind === 'PR' ? 'Requisition' : 'Purchase order',
      d.material,
      d.supplierName,
      d.plant,
      d.quantity,
      d.unit,
      d.total,
      dmy(d.deliveryDate),
      d.approvalState?.label || d.status,
      d.approvalState?.withYou ? 'You' : d.approvalState?.holder || '',
      Math.floor((Number(d.hoursWaiting) || 0) / 24),
      d.priority?.label || '',
      d.shipmentStage || ''
    ].map(cell)
  );

  return [header.map(cell), ...body].map((row) => row.join(',')).join('\r\n');
}

function stockToCsv(materials) {
  const header = ['Code', 'Material', 'Plant', 'On hand', 'Unit', 'On order', 'Asked for', 'Short by', 'Days of cover', 'Needed from'];
  const body = materials
    .filter((m) => Number(m.shortBy) > 0)
    .sort((a, b) => (Number(a.daysOfCover) || 0) - (Number(b.daysOfCover) || 0))
    .map((m) => [m.code, m.name, m.plant, m.onHand, m.unit, m.openOrderQuantity || 0, m.totalNeeded || 0, m.shortBy, m.daysOfCover, dmy(m.neededFrom)].map(cell));

  return [header.map(cell), ...body].map((row) => row.join(',')).join('\r\n');
}

// --- The three handlers --------------------------------------------------------

export const ACTION_HANDLERS = {
  async send_reminder({ approver, po_number }, context) {
    const document = context.documents.find((d) => String(d.id) === String(po_number || '').replace(/\D/g, ''));

    if (!document) {
      return { done: false, message: `There is no document numbered ${po_number}, so nothing was sent.` };
    }

    // Switched off on purpose is not the same as broken, and the person is told which.
    if (!config.mail.enabled) {
      return {
        done: false,
        message:
          `Email is switched off in this dashboard, so no reminder was sent to ${approver}. ` +
          `Everything else about ${document.id} is unchanged.`,
        mail_switched_off: true
      };
    }

    if (!mailConfigured()) {
      return { done: false, message: `Email is not set up on this server, so no reminder was sent to ${approver}.` };
    }

    const person = recipientFor(approver);
    if (!person.address) {
      return {
        done: false,
        message: `There is no mailbox on file for ${approver}, so the reminder could not be delivered.`
      };
    }

    const subject = `Reminder: ${document.kind} ${document.id} is waiting for you`;
    const body =
      `Hello ${approver},\n\n` +
      `${document.kind} ${document.id} is waiting at your step.\n\n` +
      `${document.material}, ${document.supplierName}\n` +
      `${document.plant} plant, ${inr(document.total)}\n` +
      `Delivery date ${dmy(document.deliveryDate)}\n` +
      `${Math.floor((Number(document.hoursWaiting) || 0) / 24)} days waiting so far.\n\n` +
      `Could you approve it or tell me what is holding it up.\n\n` +
      `${context.manager}`;

    const mail = await sendPlainEmail({ to: person.address, subject, body, from: config.mail.from });

    return {
      done: Boolean(mail.sent),
      message: mail.sent
        ? `Reminder sent to ${approver} at ${maskedAddress(person.address)} about ${document.id}.`
        : `The reminder to ${approver} did not go out: ${mail.status}`,
      document: document.id
    };
  },

  async export_report({ filter, format }, context) {
    const wanted = String(filter || 'all').toLowerCase();
    const kind = String(format || 'csv').toLowerCase();

    if (kind !== 'csv') {
      return { done: false, message: `${format} files are not available. CSV is the only format this dashboard exports.` };
    }

    if (wanted === 'stock') {
      const csv = stockToCsv(context.materials);
      const count = csv.split('\r\n').length - 1;
      return {
        done: true,
        message: `Exported ${count} short materials as a CSV file.`,
        filename: `stock-short-${dmy(new Date())}.csv`,
        content: csv,
        rows: count
      };
    }

    const chosen = EXPORTS[wanted] || EXPORTS.all;
    const rows = chosen.rows(context);
    const csv = documentsToCsv(rows);

    return {
      done: true,
      message: `Exported ${rows.length} documents (${chosen.title.toLowerCase()}) as a CSV file.`,
      filename: `${wanted}-${dmy(new Date())}.csv`,
      content: csv,
      rows: rows.length
    };
  },

  async flag_for_review({ po_number, reason }, context) {
    const number = String(po_number || '').replace(/\D/g, '');
    const document = context.documents.find((d) => String(d.id) === number);

    if (!document) {
      return { done: false, message: `There is no document numbered ${po_number}, so nothing was flagged.` };
    }

    const flags = await readFlags();
    const already = flags.find((f) => f.documentId === number);

    if (already) {
      already.reason = reason;
      already.flaggedAt = new Date().toISOString();
    } else {
      flags.unshift({
        documentId: number,
        kind: document.kind,
        supplierName: document.supplierName,
        material: document.material,
        reason,
        flaggedBy: context.manager,
        flaggedAt: new Date().toISOString()
      });
    }

    await writeFlags(flags);

    return {
      done: true,
      message: already
        ? `${document.kind} ${document.id} was already flagged; the note now reads "${reason}".`
        : `${document.kind} ${document.id} is flagged for your follow-up: "${reason}".`,
      document: document.id,
      total_flagged: flags.length
    };
  }
};
