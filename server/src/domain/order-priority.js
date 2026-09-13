// How urgent a purchase order is, and why.
//
// Deliberately not the requisition's question.
//
// A requisition asks whether something is needed, so it ranks on what the plant is about to
// run out of. An order has already committed to a vendor, a price and a date - the material
// question is settled. What is left is whether the commitment is being kept, which is a
// different thing entirely: how late it is, how much is riding on it, and whether the vendor
// carrying it has a record of slipping.
//
// Giving orders the requisition's bands would have produced a number that looks identical
// and means something else, which is worse than having no number at all.

import { parseWhen, daysBetween } from './requisition-priority.js';

const BAND_ORDER = ['critical', 'high', 'medium', 'low'];

// Stages at which nothing has physically left the vendor yet. An order due on Friday that
// has not been dispatched by Wednesday is a different problem from one already on the road.
const NOT_MOVING = new Set(['', 'released', 'sent']);

export function orderPriorityFor(document, today = new Date()) {
  const due = parseWhen(document.deliveryDate, today);
  const daysUntilDue = due ? daysBetween(today, due) : null;

  const stage = String(document.shipmentStage || '');
  const complete = stage === 'received';
  const moving = !NOT_MOVING.has(stage);
  const released = document.status === 'approved';

  // Whether the vendor is actually holding this order yet.
  //
  // A date can pass for two completely different reasons and only one of them is the
  // vendor's fault. If the order has been sent, they have had it and the date has gone by:
  // that is theirs to answer for. If it is still going through approval, or released and
  // nobody has told them, the delay is ours - and chasing somebody for being late with an
  // order they have never seen is how you lose a vendor, not how you get a delivery.
  const vendorHasIt = released && stage !== '' && stage !== 'released' && !complete;

  const vendor = document.supplierScore;
  const vendorAtRisk = Boolean(vendor && vendor.scored && vendor.band === 'risk');

  const reasons = [];
  let score = 0;

  if (daysUntilDue !== null && daysUntilDue < 0 && !complete) {
    score += Math.min(-daysUntilDue, 40) * 5;
    reasons.push(
      vendorHasIt
        ? `Due ${Math.abs(daysUntilDue)} days ago. The vendor has had the order and nothing has arrived.`
        : released
          ? `Due ${Math.abs(daysUntilDue)} days ago and the vendor has still not been told.`
          : `Due ${Math.abs(daysUntilDue)} days ago and it is still going through approval.`
    );
  } else if (daysUntilDue !== null && daysUntilDue <= 7 && !complete) {
    score += (8 - daysUntilDue) * 3;
    reasons.push(
      moving ? `Due in ${daysUntilDue} days and on its way.` : `Due in ${daysUntilDue} days and nothing has left the vendor.`
    );
  }

  if (vendorAtRisk && !complete) {
    score += 12;
    reasons.push(
      `${vendor.name} is ${vendor.averageDaysLate} days late on average and ${vendor.trend}.`
    );
  }

  // Money makes a late order worse, not urgent on its own. Capped so a large comfortable
  // order can never outrank a small one that has already missed its date.
  const value = Number(document.total) || 0;
  score += Math.min(value / 10000000, 3) * 4;

  const band = overdue(daysUntilDue, complete)
    ? 'critical'
    : (daysUntilDue !== null && daysUntilDue <= 7 && !complete && !moving) ||
        (vendorAtRisk && daysUntilDue !== null && daysUntilDue <= 14 && !complete)
      ? 'high'
      : daysUntilDue !== null && daysUntilDue <= 21 && !complete
        ? 'medium'
        : 'low';

  const label = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }[band];

  const advice = {
    critical: 'Chase it today',
    high: 'Watch this week',
    medium: 'On the horizon',
    low: 'Nothing pressing'
  }[band];

  return {
    band,
    label,
    advice,
    score: Math.round(score),
    daysUntilDue,
    overdue: overdue(daysUntilDue, complete),
    moving,
    released,
    complete,
    vendorHasIt,
    // Late, and late on the vendor - the only case where chasing them is the right move.
    lateOnVendor: overdue(daysUntilDue, complete) && vendorHasIt,
    // Late because of us: past the date and the vendor has not even been told.
    lateOnUs: overdue(daysUntilDue, complete) && !vendorHasIt,
    vendorAtRisk,
    reasons
  };
}

function overdue(daysUntilDue, complete) {
  return daysUntilDue !== null && daysUntilDue < 0 && !complete;
}

function bandRank(document) {
  const at = BAND_ORDER.indexOf(document.priority?.band);
  return at === -1 ? BAND_ORDER.length : at;
}

// Critical first, then High, Medium, Low; within a band the one due soonest, and where two
// fall on the same day the larger one first, because that is the one worth a phone call.
//
// Orders still needing a signature lead the list, for the same reason requisitions do: the
// question this screen answers is what needs you, and a released order needs watching rather
// than deciding.
function actionGroup(document) {
  if (document.status === 'pending') return 0;
  if (document.status === 'approved' && document.shipmentStage !== 'received') return 1;
  return 2;
}

export function byOrderPriority(documents) {
  return [...documents].sort((a, b) => {
    const group = actionGroup(a) - actionGroup(b);
    if (group !== 0) return group;

    const band = bandRank(a) - bandRank(b);
    if (band !== 0) return band;

    const whenA = a.priority?.daysUntilDue;
    const whenB = b.priority?.daysUntilDue;
    const dueA = whenA === null || whenA === undefined ? Infinity : whenA;
    const dueB = whenB === null || whenB === undefined ? Infinity : whenB;
    if (dueA !== dueB) return dueA - dueB;

    return (b.total || 0) - (a.total || 0);
  });
}
