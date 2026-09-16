// What the assistant is allowed to look at, and what it is allowed to do.
//
// Two halves, kept apart on purpose.
//
//   READ_TOOLS    answer questions. They run the moment the model asks for them.
//   ACTION_TOOLS  change something. They NEVER run when the model asks. The request is
//                 turned into a sentence, shown to the person, and only carried out after
//                 they press Confirm.
//
// The model never writes a query. It picks a name off this list and supplies arguments,
// and the handler below does the looking - against the same domain functions the screens
// use, so the assistant cannot quietly disagree with what is on the page behind it.
//
// Each handler returns a plain object. That object is what goes back to the model as a
// functionResponse, and it is also what gets logged, so it is written to be read by both.

import { money as inr } from '../domain/format.js';
import { currentStage, stageByKey, isTrackable } from '../domain/shipment.js';

// --- Shapes the model sees -----------------------------------------------------
//
// Written as plain schema objects rather than with the SDK's Type enum, because this list
// is the specification of the feature and should be readable without knowing the SDK. The
// type names are upper case because that is what the API expects - Type.OBJECT is the
// string "OBJECT" - and lower case ones come back as a 400 on the first question asked.

export const READ_TOOLS = [
  {
    name: 'get_po_status',
    description:
      'Where one purchase order or purchase requisition stands: its approval state, who is ' +
      'holding it, its value, vendor, delivery date and where the shipment has got to. Use ' +
      'this whenever the person names a document number.',
    parameters: {
      type: 'OBJECT',
      properties: {
        po_number: {
          type: 'STRING',
          description: 'The document number, for example 4500178512 or 1000442403.'
        }
      },
      required: ['po_number']
    }
  },
  {
    name: 'list_blocked_pos',
    description:
      'Purchase orders stuck waiting for approval. Optionally only those at one plant, and ' +
      'only those waiting longer than a given number of days. Use this for questions like ' +
      '"what is stuck", "what is pending release" or "what has been sitting too long".',
    parameters: {
      type: 'OBJECT',
      properties: {
        plant: {
          type: 'STRING',
          description: 'Plant name: Pune, Mumbai or Nagpur. Omit for all plants.'
        },
        days_pending: {
          type: 'NUMBER',
          description: 'Only orders waiting longer than this many days. Omit for all.'
        }
      },
      required: []
    }
  },
  {
    name: 'list_late_deliveries',
    description:
      'Orders past their delivery date, separated by whose side the delay is on: the vendor ' +
      'has the order and has not delivered, or the order has not been sent to the vendor yet. ' +
      'Use this for anything about late, overdue, delayed, slipped or chasing a delivery. It ' +
      'is NOT the same as an order waiting for approval - use list_blocked_pos for that.',
    parameters: {
      type: 'OBJECT',
      properties: {
        plant: { type: 'STRING', description: 'Plant name. Omit for all plants.' }
      },
      required: []
    }
  },
  {
    name: 'get_stock',
    description:
      'The stock position for a material: what is on hand, what is on order, what has been ' +
      'asked for, how short it is and how many days of cover are left.',
    parameters: {
      type: 'OBJECT',
      properties: {
        material: {
          type: 'STRING',
          description: 'Material name or code, for example "gypsum" or RM-1042. Omit to list everything short.'
        },
        plant: { type: 'STRING', description: 'Plant name. Omit for all plants.' }
      },
      required: []
    }
  },
  {
    name: 'get_vendor_summary',
    description:
      'How a vendor has actually performed: their score, delivery record, quality, rate ' +
      'against contract, and what is currently open with them.',
    parameters: {
      type: 'OBJECT',
      properties: {
        vendor: { type: 'STRING', description: 'Vendor name or vendor number, for example "Aditya" or V-10024.' },
        period: {
          type: 'STRING',
          description: 'How far back to count open documents: "this month", "3 months", "6 months" or "12 months". Omit for all.'
        }
      },
      required: ['vendor']
    }
  }
];

export const ACTION_TOOLS = [
  {
    name: 'send_reminder',
    description:
      'Send a reminder to the person currently holding a document, asking them to act on it. ' +
      'Only use when the person asks to chase or remind somebody.',
    parameters: {
      type: 'OBJECT',
      properties: {
        approver: { type: 'STRING', description: 'Who to remind. Use the name the tools gave you.' },
        po_number: { type: 'STRING', description: 'The document number the reminder is about.' }
      },
      required: ['approver', 'po_number']
    }
  },
  {
    name: 'export_report',
    description:
      'Produce the current list as a file the person can download. Use when they ask for an ' +
      'export, a download, a spreadsheet or something to send on.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filter: {
          type: 'STRING',
          description:
            'What to export: "pending" for everything awaiting approval, "late" for anything ' +
            'past its delivery date, "stock" for materials short, "all" for every document.'
        },
        format: { type: 'STRING', description: 'csv is the only format available.' }
      },
      required: ['filter']
    }
  },
  {
    name: 'flag_for_review',
    description:
      'Mark a document so it comes back to the person later, with a note saying why. Use when ' +
      'they say to remember something, come back to it, or keep an eye on it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        po_number: { type: 'STRING', description: 'The document number to flag.' },
        reason: { type: 'STRING', description: 'Why, in the person\'s own words where possible.' }
      },
      required: ['po_number', 'reason']
    }
  }
];

export const ALL_TOOLS = [...READ_TOOLS, ...ACTION_TOOLS];

export const ACTION_NAMES = new Set(ACTION_TOOLS.map((t) => t.name));

export function isAction(name) {
  return ACTION_NAMES.has(name);
}

// --- Small shared helpers ------------------------------------------------------

// "5 Sep 2026" as 05-SEP-2026, which is the form the system prompt asks for. Anything
// unparseable is handed back untouched rather than turned into "Invalid Date".
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function dmy(value) {
  if (!value) return null;
  const when = value instanceof Date ? value : new Date(String(value).replace(',', ''));
  if (Number.isNaN(when.getTime())) return String(value);
  return `${String(when.getDate()).padStart(2, '0')}-${MONTHS[when.getMonth()]}-${when.getFullYear()}`;
}

function loosely(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\-.,]/g, '');
}

function atPlant(row, plant) {
  if (!plant || /^all$/i.test(plant)) return true;
  return String(row.plant || '').toLowerCase() === String(plant).toLowerCase();
}

// "3 months" as a cut-off date. Anything unrecognised means no cut-off at all, which is
// safer than silently narrowing the answer to a window nobody asked for.
function since(period) {
  if (!period) return null;
  const text = String(period).toLowerCase();
  const now = new Date();
  if (/this month/.test(text)) return new Date(now.getFullYear(), now.getMonth(), 1);
  const months = /(\d+)\s*month/.exec(text);
  if (months) {
    const from = new Date(now);
    from.setMonth(from.getMonth() - Number(months[1]));
    return from;
  }
  if (/year/.test(text)) {
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - 1);
    return from;
  }
  return null;
}

// One document, described the way the model should repeat it back.
function describeDocument(document) {
  const state = document.approvalState || {};
  const finished = state.state === 'approved' || state.state === 'rejected';

  return {
    number: document.id,
    kind: document.kind === 'PR' ? 'requisition' : 'purchase order',
    material: document.material,
    vendor: document.supplierName,
    plant: document.plant,
    quantity: `${document.quantity} ${document.unit}`,
    value: inr(document.total),
    delivery_date: dmy(document.deliveryDate),
    approval_status: state.label || document.status,
    held_by: finished ? null : state.withYou ? 'the person you are talking to' : state.holder || null,
    signed_by: state.signedBy || null,
    signed_on: state.signedAt || null,
    approval_step: document.step || null,
    waiting_hours: document.hoursWaiting ?? null,
    priority: document.priority ? `${document.priority.label} - ${document.priority.advice}` : null,
    why: document.priority?.reasons?.[0] || null,
    shipment: isTrackable(document) ? stageByKey(currentStage(document))?.label || null : null,
    trade: document.trade || null
  };
}

// --- Read handlers -------------------------------------------------------------

export const READ_HANDLERS = {
  get_po_status({ po_number }, { documents }) {
    const wanted = String(po_number || '').replace(/\D/g, '');
    const document = documents.find((d) => String(d.id) === wanted);

    if (!document) {
      return {
        found: false,
        message: `No document numbered ${po_number} is visible in this dashboard.`
      };
    }

    return { found: true, document: describeDocument(document) };
  },

  list_blocked_pos({ plant, days_pending }, { documents }) {
    const minimum = Number(days_pending) || 0;
    const stuck = documents
      .filter((d) => d.kind === 'PO' && d.status === 'pending')
      .filter((d) => atPlant(d, plant))
      .filter((d) => (Number(d.hoursWaiting) || 0) / 24 >= minimum)
      .sort((a, b) => (b.hoursWaiting || 0) - (a.hoursWaiting || 0));

    return {
      count: stuck.length,
      plant: plant || 'all plants',
      waiting_longer_than_days: minimum || null,
      total_value: inr(stuck.reduce((sum, d) => sum + (Number(d.total) || 0), 0)),
      orders: stuck.map((d) => ({
        number: d.id,
        vendor: d.supplierName,
        material: d.material,
        plant: d.plant,
        value: inr(d.total),
        days_pending: Math.floor((Number(d.hoursWaiting) || 0) / 24),
        approval_status: d.approvalState?.label || d.status,
        held_by: d.approvalState?.withYou ? 'the person you are talking to' : d.approvalState?.holder || null,
        delivery_date: dmy(d.deliveryDate)
      }))
    };
  },

  // Late, and whose fault.
  //
  // The split is the whole answer. An order past its date because the vendor has not
  // delivered is a phone call to the vendor; one past its date because nobody has sent it
  // to them yet is a phone call to ourselves - and chasing somebody over an order they have
  // never seen is how a vendor is lost. Both come from the same priority worked out for the
  // screens, so the assistant cannot disagree with what the dashboard shows.
  list_late_deliveries({ plant }, { documents }) {
    const late = documents
      .filter((d) => d.priority?.overdue)
      .filter((d) => atPlant(d, plant))
      .sort((a, b) => (a.priority.daysUntilDue ?? 0) - (b.priority.daysUntilDue ?? 0));

    const row = (d) => ({
      number: d.id,
      kind: d.kind === 'PR' ? 'requisition' : 'purchase order',
      material: d.material,
      vendor: d.supplierName,
      plant: d.plant,
      value: inr(d.total),
      delivery_date: dmy(d.deliveryDate),
      days_past_the_date: Math.abs(d.priority.daysUntilDue),
      shipment: isTrackable(d) ? stageByKey(currentStage(d))?.label || null : null,
      why: d.priority.reasons?.[0] || null
    });

    const theirs = late.filter((d) => d.priority.lateOnVendor);
    const ours = late.filter((d) => !d.priority.lateOnVendor);

    return {
      count: late.length,
      plant: plant || 'all plants',
      message:
        late.length === 0
          ? 'Nothing is past its delivery date.'
          : `${late.length} past the delivery date.`,
      late_on_the_vendor: { count: theirs.length, note: 'They have the order and it has not arrived. Chase them.', orders: theirs.map(row) },
      late_on_us: { count: ours.length, note: 'The date has gone and the vendor has not been told to start. Ours to fix.', orders: ours.map(row) }
    };
  },

  get_stock({ material, plant }, { materials }) {
    const inScope = materials.filter((m) => atPlant(m, plant));

    if (!material) {
      const short = inScope
        .filter((m) => Number(m.shortBy) > 0)
        .sort((a, b) => (Number(a.daysOfCover) || 0) - (Number(b.daysOfCover) || 0));
      return {
        count: short.length,
        materials: short.map((m) => ({
          code: m.code,
          name: m.name,
          plant: m.plant,
          short_by: `${Number(m.shortBy).toLocaleString('en-IN')} ${m.unit}`,
          days_of_cover: m.daysOfCover,
          needed_from: dmy(m.neededFrom),
          feeds_the_kiln: Boolean(m.kiln)
        }))
      };
    }

    const needle = loosely(material);
    const found = inScope.filter((m) => loosely(m.code).includes(needle) || loosely(m.name).includes(needle));

    if (found.length === 0) {
      return { found: false, message: `No material matching "${material}" is visible in this dashboard.` };
    }

    return {
      found: true,
      materials: found.map((m) => ({
        code: m.code,
        name: m.name,
        plant: m.plant,
        on_hand: `${Number(m.onHand).toLocaleString('en-IN')} ${m.unit}`,
        on_order: `${Number(m.openOrderQuantity || 0).toLocaleString('en-IN')} ${m.unit}`,
        asked_for: `${Number(m.totalNeeded || 0).toLocaleString('en-IN')} ${m.unit}`,
        short_by: Number(m.shortBy) > 0 ? `${Number(m.shortBy).toLocaleString('en-IN')} ${m.unit}` : 'not short',
        days_of_cover: m.daysOfCover,
        lead_time_days: m.leadTimeDays,
        needed_from: dmy(m.neededFrom),
        usual_vendor: m.supplierName,
        feeds_the_kiln: Boolean(m.kiln)
      }))
    };
  },

  get_vendor_summary({ vendor, period }, { documents, vendors }) {
    const needle = loosely(vendor);
    const found =
      vendors.find((v) => loosely(v.supplierId) === needle) ||
      vendors.find((v) => loosely(v.name).includes(needle)) ||
      vendors.find((v) => loosely(v.name).split(' ')[0] === needle);

    if (!found) {
      return { found: false, message: `No vendor matching "${vendor}" is visible in this dashboard.` };
    }

    const from = since(period);
    const theirs = documents
      .filter((d) => d.supplierId === found.supplierId)
      .filter((d) => !from || !d.raisedAt || new Date(d.raisedAt) >= from);

    return {
      found: true,
      vendor: {
        number: found.supplierId,
        name: found.name,
        city: found.city,
        category: found.category,
        scored: Boolean(found.scored),
        score: found.scored ? `${found.total} out of 100` : null,
        standing: found.scored ? found.bandLabel : found.reasonNotScored || 'not scored yet',
        on_time_percent: found.scored ? found.onTimePercent : null,
        average_days_late: found.scored ? found.averageDaysLate : null,
        trend: found.scored ? found.trend : null,
        quality_accepted_percent: found.scored ? found.averageQuality : null,
        rate_against_contract_percent: found.scored ? found.percentOverContract : null
      },
      period: period || 'all time',
      open_documents: theirs.map((d) => ({
        number: d.id,
        kind: d.kind === 'PR' ? 'requisition' : 'purchase order',
        material: d.material,
        value: inr(d.total),
        approval_status: d.approvalState?.label || d.status,
        delivery_date: dmy(d.deliveryDate)
      }))
    };
  }
};

// --- Describing an action before it happens ------------------------------------
//
// The one line the person reads before pressing Confirm. Built here rather than left to
// the model, because this sentence is the last thing standing between a misread question
// and something actually happening, and it has to describe what the code will do - not
// what the model believes it asked for.

export function describeAction(name, args, context) {
  const { documents } = context;
  const document = documents.find((d) => String(d.id) === String(args.po_number || '').replace(/\D/g, ''));

  if (name === 'send_reminder') {
    return {
      summary: `Send ${args.approver} a reminder about ${document ? document.kind : 'document'} ${args.po_number}`,
      detail: document
        ? [`${document.material}, ${document.supplierName}`, `${document.plant} plant, ${inr(document.total)}`]
        : [`Document ${args.po_number} is not visible in this dashboard.`],
      confirmLabel: 'Send it'
    };
  }

  if (name === 'export_report') {
    const what =
      { pending: 'everything awaiting approval', late: 'everything past its delivery date', stock: 'materials short', all: 'every document' }[
        String(args.filter || 'all').toLowerCase()
      ] || String(args.filter);
    return {
      summary: `Export ${what} as a ${String(args.format || 'csv').toUpperCase()} file`,
      detail: ['The file downloads to this computer. Nothing is sent anywhere.'],
      confirmLabel: 'Export'
    };
  }

  if (name === 'flag_for_review') {
    return {
      summary: `Flag ${document ? document.kind : 'document'} ${args.po_number} for your follow-up`,
      detail: [args.reason, document ? `${document.material}, ${document.supplierName}` : 'Not visible in this dashboard.'].filter(
        Boolean
      ),
      confirmLabel: 'Flag it'
    };
  }

  return { summary: `Run ${name}`, detail: [], confirmLabel: 'Confirm' };
}
