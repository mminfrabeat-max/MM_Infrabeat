// Small functions that pick things out of the dashboard payload.
//
// These live here rather than inside screens for one reason: the plant selector at the top
// of the page changes what nearly every screen shows, and the filtering rule needs to be
// written once. A screen that filtered its own way would quietly disagree with the tile
// count next to it.
//
// Nothing here decides anything. The business rules are all in the backend; these only
// choose which rows to look at.

export function byPlant(rows, plant) {
  if (!rows) return [];
  if (plant === 'all') return rows;
  return rows.filter((r) => r.plant === plant);
}

// Mirrors server/src/domain/approvals.js. The server decides for real - it is the only
// side that can - but the screen has to know whether to draw a button before it asks.
// If the two ever disagree, the server wins and the click comes back as an error.
export function stillNeedsSigning(document) {
  if (document.status !== "pending") return false;
  if (!document.decidedAt) return true;
  return Boolean(document.next && document.next.name);
}

// True when a click records the NEXT approver decision rather than making your own.
export function recordingForNext(document) {
  return stillNeedsSigning(document) && Boolean(document.decidedAt);
}

export function pendingDocuments(documents, plant) {
  return byPlant(documents, plant).filter((d) => d.status === 'pending');
}

// Orders and requisitions are approved in different places now, so the counts on the two
// tabs have to be counted separately. `kind` is 'PO' or 'PR'.
export function pendingOfKind(documents, plant, kind) {
  return pendingDocuments(documents, plant).filter((d) => d.kind === kind);
}

// Everything of one kind, whatever its status - what each approval list shows.
// Requisitions in the order they should be worked through. Mirrors
// server/src/domain/requisition-priority.js, which computes the urgency score itself.
// Most urgent first, but only among the ones that still need a decision.
//
// The list exists to answer "what should I approve next", so a requisition already
// released has no business competing for the top of it however short the material is.
// Three groups, in the order somebody works through them: waiting on you, then waiting on
// somebody else (chase those), then finished. Urgency orders within each group.
function actionGroup(document) {
  // Yours to sign, then somebody else’s to be chased for, then finished. Read from
  // whose turn it is rather than from the status, because a partly approved document
  // can be sitting on either desk and the two belong in different groups.
  const open = document.status === 'pending';
  if (open && document.approvalState?.withYou) return 0;
  if (open) return 1;
  return 2;
}

// The band is what the row actually says - "Approve today", "Approve this week" - so it has
// to lead the ordering. Sorting by the raw score alone put a "this week" above a "today",
// which reads as the list contradicting itself however defensible the arithmetic was.
const BANDS = ['critical', 'high', 'medium', 'low'];

function bandRank(document) {
  const at = BANDS.indexOf(document.priority?.band);
  return at === -1 ? BANDS.length : at;
}

// Critical, then High, then Medium, then Low. Within a band, whichever is wanted soonest.
// Where two are wanted on the same day, the one with the bigger shortage goes first.
//
// Action state still leads all of it, and that is deliberate: a requisition already
// released has no business competing for the top of a list whose question is "what should
// I approve next", however short its material is. Waiting on you, then waiting on somebody
// else to chase, then finished - and the rule above orders each group.
export function byPriority(documents) {
  return [...documents].sort((a, b) => {
    const group = actionGroup(a) - actionGroup(b);
    if (group !== 0) return group;

    const band = bandRank(a) - bandRank(b);
    if (band !== 0) return band;

    // Soonest wanted first. A requisition with no date cannot claim to be urgent, so it
    // sorts behind every one that has a date rather than ahead of them.
    const whenA = a.priority?.daysUntilNeeded;
    const whenB = b.priority?.daysUntilNeeded;
    const dateA = whenA === null || whenA === undefined ? Infinity : whenA;
    const dateB = whenB === null || whenB === undefined ? Infinity : whenB;
    if (dateA !== dateB) return dateA - dateB;

    const shortA = a.priority?.shortageAgainstStock || 0;
    const shortB = b.priority?.shortageAgainstStock || 0;
    if (shortA !== shortB) return shortB - shortA;

    return (b.total || 0) - (a.total || 0);
  });
}

export function documentsOfKind(documents, plant, kind) {
  return byPlant(documents, plant).filter((d) => d.kind === kind);
}

export function overdueDocuments(documents, plant, hours = 24) {
  return pendingDocuments(documents, plant)
    .filter((d) => d.hoursWaiting > hours)
    .sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

export function sumTotals(documents) {
  return documents.reduce((sum, d) => sum + d.total, 0);
}

export function sumValues(rows) {
  return rows.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
}

// Materials that are short against real demand, or that run out before a new load lands.
export function shortMaterials(materials, plant) {
  return byPlant(materials, plant).filter((m) => m.shortBy > 0 || m.runsOutFirst);
}

export function contractsToWatch(contracts, plant) {
  return byPlant(contracts, plant).filter((c) => c.needsAttention);
}

export function openSituations(situations, plant) {
  return byPlant(situations, plant).filter((s) => s.status === 'open');
}

export function teamsNeedingNudge(teams, plant) {
  return byPlant(teams, plant).filter((t) => t.state === 'nudge');
}

// The vendor with the lowest standing among those actually visible at this plant. Falls
// back to the overall worst when no document at this plant names a scored vendor.
export function weakestVendor(suppliers) {
  const scored = (suppliers || []).filter((s) => s.scored);
  if (scored.length === 0) return null;
  return scored.reduce((worst, s) => (s.total < worst.total ? s : worst));
}

export function findDocument(documents, id) {
  return (documents || []).find((d) => d.id === id) || null;
}

// The stock row for a document's material at that document's plant, used to price what
// happens if the order is sent back.
export function materialFor(materials, document) {
  if (!document) return null;
  return (materials || []).find((m) => m.code === document.materialCode) || null;
}

// What a requisition needs next, as one answer the screen can draw.
//
// Four states, and they are not the same question as the approval status. "Approved" says
// the signing is finished; it does not say whether anybody has bought anything, and that
// is the gap a requisition falls down. A released requisition with no order against it is
// the most expensive row on the list precisely because it looks finished.
//
// The link is read from the order end: a purchase order carries the requisition it was
// created from, the way a PO item does in SAP, so finding the order means looking for the
// one that names this requisition.
export function orderRaisedFrom(documents, requisition) {
  return (documents || []).find((d) => d.kind === 'PO' && d.sourceDocument === requisition.id) || null;
}

export function requisitionAction(documents, requisition) {
  if (requisition.status === 'rejected') {
    // Nothing to do here. It went back to whoever raised it, and the next move is theirs.
    return { state: 'closed', label: 'Rejected' };
  }

  if (requisition.status !== 'approved') {
    // Still being signed. The action is the approval itself, which the row already offers
    // by being clickable, so the column says who it is with rather than repeating it.
    return { state: 'approving' };
  }

  const order = orderRaisedFrom(documents, requisition);
  if (order) {
    return { state: 'ordered', label: 'View PO', order };
  }

  return { state: 'to-order', label: 'Raise PO' };
}

// What an order needs next.
//
// Four states, and only two of them are things the row can do that clicking it cannot.
// That is the point of the column: a button that merely repeats the row's own click has
// earned nothing, so the ones that matter here are the two that write a mail - chasing the
// approver who is holding it, and chasing the vendor who is late with it.
export function orderAction(document) {
  if (document.status === 'rejected') {
    return { state: 'closed' };
  }

  if (document.status === 'pending') {
    // Yours to sign, or somebody else’s to be chased for.
    //
    // Read from the approval state rather than from stillNeedsSigning, which stays true
    // after you have signed - it also covers recording the next approver’s decision on
    // their behalf. An order you have already passed on would otherwise have offered you
    // its Approve button a second time.
    const waitingOnYou = document.approvalState?.withYou !== false && !recordingForNext(document);
    return waitingOnYou
      ? { state: 'to-approve' }
      : { state: 'with-someone', holder: document.approvalState?.holder || document.next?.name || '' };
  }

  // Released. What is left depends on who the delay belongs to.
  const late = Math.abs(document.priority?.daysUntilDue || 0);

  // The vendor has the order and the date has gone by. Theirs to answer for.
  if (document.priority?.lateOnVendor) {
    return { state: 'overdue', daysLate: late };
  }

  // Released, but nobody has told the vendor. Chasing them here would be chasing somebody
  // for an order they have never seen; the thing that is actually missing is the sending.
  if (!document.priority?.vendorHasIt && document.shipmentStage !== 'received') {
    return {
      state: 'to-send',
      daysLate: document.priority?.lateOnUs ? late : 0
    };
  }

  return { state: 'released' };
}

// Orders in the order somebody works through them. Mirrors
// server/src/domain/order-priority.js, which decides the bands themselves.
//
// Critical first, then High, Medium, Low; within a band the one due soonest, and where two
// fall on the same day the larger one first, because that is the one worth a phone call.
// Orders still needing a signature lead, then those released and still in flight, then the
// ones that are finished - the same "what needs me" shape the requisition list has.
const ORDER_BANDS = ['critical', 'high', 'medium', 'low'];

function orderGroup(document) {
  if (document.status === 'pending') return 0;
  if (document.status === 'approved' && document.shipmentStage !== 'received') return 1;
  return 2;
}

export function byOrderPriority(documents) {
  return [...documents].sort((a, b) => {
    const group = orderGroup(a) - orderGroup(b);
    if (group !== 0) return group;

    const band =
      ORDER_BANDS.indexOf(a.priority?.band) - ORDER_BANDS.indexOf(b.priority?.band);
    if (band !== 0) return band;

    const whenA = a.priority?.daysUntilDue;
    const whenB = b.priority?.daysUntilDue;
    const dueA = whenA === null || whenA === undefined ? Infinity : whenA;
    const dueB = whenB === null || whenB === undefined ? Infinity : whenB;
    if (dueA !== dueB) return dueA - dueB;

    return (b.total || 0) - (a.total || 0);
  });
}

// Narrowing a list by when a document was raised, and by where it has got to.
//
// Two separate questions, kept separate. "Show me the last three months" is about what to
// look at; "show me what is still pending" is about what to do. Somebody asking one is
// rarely asking the other, and a single combined control would force them to.
export const PERIODS = [
  { key: 'all', label: 'Any time', months: null },
  // Calendar, from the first of the month. Kept apart from the rolling windows below
  // because it answers a different question - what have we raised this month, which is
  // how budgets and monthly reports are counted.
  { key: 'thismonth', label: 'Raised this month', months: null, calendarMonth: true },
  // Rolling, and said in days rather than months on purpose: "the last month" reads as
  // August to most people, which is neither what this counts nor what "this month" means.
  { key: '30d', label: 'Raised in the last 30 days', days: 30 },
  { key: '3m', label: 'Raised in the last 3 months', months: 3 },
  { key: '6m', label: 'Raised in the last 6 months', months: 6 },
  { key: '1y', label: 'Raised in the last year', months: 12 }
];

// The four states a document can be in, in the words the Status column uses.
export const APPROVAL_STATES = [
  { key: 'all', label: 'Any status', state: null },
  { key: 'waiting', label: 'Pending', state: 'waiting' },
  { key: 'partial', label: 'Partially approved', state: 'partial' },
  { key: 'approved', label: 'Approved', state: 'approved' },
  { key: 'rejected', label: 'Rejected', state: 'rejected' }
];

export function withinPeriod(document, periodKey, today = new Date()) {
  const period = PERIODS.find((p) => p.key === periodKey);
  if (!period) return true;
  if (!period.calendarMonth && !period.days && period.months === null) return true;

  // A document with no raised date on it cannot be shown to be inside a window, and
  // quietly keeping it would make the count wrong in the direction nobody checks.
  if (!document.raisedAt) return false;
  const raised = new Date(document.raisedAt);

  if (period.calendarMonth) {
    return (
      raised.getFullYear() === today.getFullYear() && raised.getMonth() === today.getMonth()
    );
  }

  const cutoff = new Date(today);
  if (period.days) cutoff.setDate(cutoff.getDate() - period.days);
  else cutoff.setMonth(cutoff.getMonth() - period.months);
  return raised >= cutoff;
}

export function matchesApprovalState(document, stateKey) {
  const wanted = APPROVAL_STATES.find((s) => s.key === stateKey);
  if (!wanted || wanted.state === null) return true;
  return (document.approvalState?.state || 'waiting') === wanted.state;
}
