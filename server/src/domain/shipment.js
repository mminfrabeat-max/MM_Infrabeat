// Where the goods are, once an order has been released.
//
// The third of the business rules, alongside approvals.js and creation.js. Approving is
// finished with a document; this is what happens to it afterwards, which in a P2P cycle is
// most of its life: an order is released, the vendor is told, they dispatch, it travels, it
// arrives, and somebody books it in.
//
// Nothing here talks to a vendor, a carrier or SAP, because nothing can. There is no
// integration to any of them, so every stage below is recorded by the person watching it
// happen rather than reported by the thing it describes. That is worth being plain about:
// a stage line that advanced on its own would look like live tracking and be fiction.

// The stages in order. A shipment only ever moves forwards through this list.
//
// 'Released' is not stored - it is what a released order already is, and inventing a
// written stage for it would mean every existing order needed one before the screen could
// show it. An order with no stage recorded is at the start of the line.
export const STAGES = [
  {
    key: 'released',
    label: 'Released',
    describe: 'Approved and released. The vendor has not been told yet.',
    stored: false
  },
  {
    key: 'sent',
    label: 'Sent to vendor',
    describe: 'The order has gone to the vendor.',
    action: 'Mark as sent to vendor'
  },
  {
    key: 'dispatched',
    label: 'Dispatched',
    describe: 'The vendor has dispatched the material from their end.',
    action: 'Mark as dispatched'
  },
  {
    key: 'transit',
    label: 'In transit',
    describe: 'On its way to the plant.',
    action: 'Mark as in transit'
  },
  {
    key: 'delivered',
    label: 'Delivered',
    describe: 'Arrived at the plant.',
    action: 'Mark as delivered'
  },
  {
    key: 'received',
    label: 'Goods receipt',
    describe: 'Booked into stock. The order is complete.',
    action: 'Book the goods receipt'
  }
];

export const FIRST_STAGE = STAGES[0].key;
export const LAST_STAGE = STAGES[STAGES.length - 1].key;

export function stageByKey(key) {
  return STAGES.find((s) => s.key === key) || null;
}

export function stageIndex(key) {
  const found = STAGES.findIndex((s) => s.key === key);
  return found === -1 ? 0 : found;
}

// An order that has finished its approvals and is therefore out with the vendor.
//
// Requisitions are excluded on purpose: a requisition is a request to buy, and nothing
// ships against one. Only an order commits a vendor to sending anything.
export function isTrackable(document) {
  return document.kind === 'PO' && document.status === 'approved';
}

// Where this order currently is. Nothing recorded means it has only just been released.
export function currentStage(document) {
  const key = String(document.shipmentStage || '').trim();
  return stageByKey(key) ? key : FIRST_STAGE;
}

// The stage this order would move to next, or null when it has arrived and been booked in.
export function nextStage(document) {
  const index = stageIndex(currentStage(document));
  return index >= STAGES.length - 1 ? null : STAGES[index + 1];
}

export function isComplete(document) {
  return currentStage(document) === LAST_STAGE;
}

// Whether a move from where it is to `target` is allowed.
//
// Only one step, and only forwards. A shipment that could jump to "Delivered" from
// "Released" would let somebody book in goods that were never recorded as sent, and a
// shipment that could go backwards would quietly erase the times already stamped on it.
// Correcting a mistake is a real need, but it is an amendment with a reason, not a button
// that silently rewrites history - so it is refused here rather than half-supported.
export function canAdvanceTo(document, target) {
  if (!isTrackable(document)) {
    return { ok: false, why: `${document.id} has not been released, so nothing is on its way yet.` };
  }

  const next = nextStage(document);
  if (!next) {
    return { ok: false, why: `${document.id} has already been booked into stock. It is complete.` };
  }

  if (!target) return { ok: true, stage: next };

  if (target === currentStage(document)) {
    return { ok: false, why: `${document.id} is already at "${stageByKey(target)?.label || target}".` };
  }

  if (target !== next.key) {
    const wanted = stageByKey(target);
    if (!wanted) return { ok: false, why: `There is no shipment stage called "${target}".` };
    return {
      ok: false,
      why:
        stageIndex(target) < stageIndex(currentStage(document))
          ? `A shipment cannot go back to "${wanted.label}". Stages are a record of what happened.`
          : `${document.id} has to be marked "${next.label}" before it can go to "${wanted.label}".`
    };
  }

  return { ok: true, stage: next };
}

// One sentence for the screen and the log, saying where it is in plain words.
export function stageSentence(document) {
  const stage = stageByKey(currentStage(document));
  if (!stage) return '';
  if (currentStage(document) === FIRST_STAGE) {
    return `${document.id} is released. ${stage.describe}`;
  }
  return `${document.id}: ${stage.label.toLowerCase()}${document.shipmentStageAt ? `, recorded ${document.shipmentStageAt}` : ''}.`;
}
