// Joins a purchase document to its vendor's standing, and turns the two into something a
// head of department can act on without opening SAP.
//
// Two pieces of writing happen here, and both are business rules rather than presentation:
//
//   advice        what to watch before approving
//   consequence   the same decision priced BOTH ways
//
// The second is the one that earns its place. Every dashboard tells you what is wrong.
// Almost none tell you what happens if you do nothing about it, which is the half of the
// decision a manager is actually weighing.

import { money, rupees } from './format.js';
import { priorityFor, parseWhen } from './requisition-priority.js';
import { orderPriorityFor } from './order-priority.js';
import { approvalStateOf } from './approvals.js';

export const OVERDUE_HOURS = 24;

function round1(n) {
  return Math.round(n * 10) / 10;
}

// What the company actually pays: the goods plus getting them here.
// The date a document was raised, or null when it does not say.
//
// Seeded rows write it as “28 Aug, 11:20” and history rows as “3 Dec 2025, 09:10”, so the
// year is sometimes absent and has to be assumed. Anything raised is in the past, which
// is the one thing that makes the assumption safe.
function raisedDate(document) {
  const text = String(document.createdBy?.when || '');

  // Two hands write this field. Seeded rows are prose - "28 Aug, 11:20" - and anything
  // raised through the dashboard is a local timestamp, "11/9/2026, 3:45:07 pm", day first.
  // Only the first was ever parsed, so a requisition raised today had no date the filters
  // could see and fell out of every window except "any time" - the newest row on the list
  // being the one a date filter could not find.
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text.trim());
  if (numeric) {
    const when = new Date(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]));
    return Number.isNaN(when.getTime()) ? null : when.toISOString();
  }

  const when = parseWhen(text);
  if (!when) return null;

  // A bare "28 Aug" with no year is assumed to be this year, which reads as the future for
  // anything raised late in December. Nothing is raised tomorrow.
  const now = new Date();
  if (when > now) when.setFullYear(when.getFullYear() - 1);
  return when.toISOString();
}

export function totalValue(document) {
  return document.basic + (document.freight || 0) + (document.loading || 0);
}

// Older documents may carry no item list. Build a single line from the header so every
// screen can assume items always exist.
export function itemsOf(document) {
  if (document.items && document.items.length > 0) return document.items;
  return [
    {
      pos: 10,
      materialCode: document.materialCode,
      material: document.material,
      type: '',
      typeText: '',
      group: '',
      groupText: '',
      quantity: document.quantity,
      unit: document.unit,
      rate: document.rate
    }
  ];
}

function buildAdvice(document, score) {
  const importNote =
    document.trade === 'Import'
      ? ` This is an import order on ${document.incoterm.split(',')[0]} terms, so the price includes freight to the port and the loading charge is ours.`
      : '';

  if (!score || !score.scored) {
    return `There are no completed orders for this vendor yet, so there is no delivery record to judge them on. Check the rate against the agreed price before approving.${importNote}`;
  }

  if (score.band === 'good') {
    return `${score.name} delivers on time ${score.onTimePercent} percent of the time and the rate matches contract. Nothing here needs a second look.${importNote}`;
  }

  if (score.band === 'watch') {
    return `${score.name} is on average ${score.averageDaysLate} days late. Approve, but ask the buyer to add a delivery condition before the order goes out.${importNote}`;
  }

  return (
    `${score.name} has gone from ${score.earlierDaysLate} days late to ${score.recentDaysLate} days late over their last ten orders, ` +
    `and is charging ${score.percentOverContract} percent above the contract rate, which is ` +
    `${money(document.basic * score.percentOverContract / 100)} on this order. ` +
    `Approve the quantity if you must, but get the rate fixed and a firm date first.${importNote}`
  );
}

// The same decision, priced both ways. Needs the stock position and the contract, because
// "send it back" is only cheap if you have the cover to wait.
function buildConsequence(document, score, material, contract) {
  const over = score?.scored ? score.percentOverContract : 0;
  const overAmount = Math.round(document.basic * over / 100);
  const coverDays = material ? Math.floor(material.onHand / material.dailyUsage) : null;

  const ifApproved =
    `Goods are due ${document.deliveryDate}. ` +
    (over > 0
      ? `The rate is ${over} percent above contract, ${money(overAmount)} more than the agreed price on this order` +
        (contract
          ? `, and about ${money(Math.round(contract.target * over / 100))} across the full ${money(contract.target)} contract if every order goes at this rate.`
          : '.')
      : 'The rate is at or below the contract rate, so nothing is lost on price.');

  const ifSentBack = material
    ? `A re-quote takes about a week and the lead time is ${material.leadTimeDays} days, so the material would land roughly ` +
      `${7 + material.leadTimeDays} days from now. ${document.plant} has ${coverDays} days of cover on ${material.name} at today's use.`
    : `A re-quote takes about a week. There is no stock buffer on this one, so the ${String(document.material).toLowerCase()} schedule moves with it.`;

  return { ifApproved, ifSentBack };
}

export function enrichDocument(document, scoresById, materials = [], contracts = []) {
  const score = scoresById[document.supplierId] || null;
  const material = materials.find((m) => m.code === document.materialCode) || null;
  const contract = contracts.find((c) => c.supplierName === (score ? score.name : null)) || null;

  const percentOverContract = score?.scored
    ? round1(((document.rate - score.contractRate) / score.contractRate) * 100)
    : null;

  return {
    ...document,
    items: itemsOf(document),
    total: totalValue(document),
    // When it was raised, as a date rather than the line of prose it is written as.
    //
    // Worked out here rather than on the screen, because the screen would have to parse
    // “28 Aug, 11:20” on every row on every keystroke, and two places parsing the same
    // string differently is how a filter starts disagreeing with the list it filters.
    raisedAt: raisedDate(document),
    supplierName: score ? score.name : 'Unknown vendor',
    // Where the vendor ships from. Only used to place a consignment between there and the
    // plant; the dashboard has no other use for a vendor's address.
    supplierCity: score ? score.city || '' : '',
    supplierScore: score,
    percentOverContract,
    isOverdue: document.hoursWaiting > OVERDUE_HOURS,
    advice: buildAdvice(document, score),
    consequence: buildConsequence(document, score, material, contract),
    // Both kinds carry one, and they are not the same measure.
    //
    // A requisition is judged on what the plant is about to run out of, which is a fact
    // about the yard. An order has already settled the material question and committed to
    // a vendor, a price and a date, so it is judged on whether that commitment is being
    // kept: how late, how much is riding on it, and who is carrying it.
    priority:
      document.kind === 'PR'
        ? priorityFor(document, materials)
        : orderPriorityFor({ ...document, supplierScore: score, total: totalValue(document) }),
    // Where it stands and whose desk it is on. On both kinds, because "pending" hides two
    // different situations and a list that cannot tell them apart is not worth reading.
    approvalState: approvalStateOf(document)
  };
}

export function enrichAllDocuments(documents, scoresById, materials, contracts) {
  return documents.map((d) => enrichDocument(d, scoresById, materials, contracts));
}

export function byLongestWait(documents) {
  return [...documents].sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

export function sumTotals(documents) {
  return documents.reduce((sum, d) => sum + totalValue(d), 0);
}
