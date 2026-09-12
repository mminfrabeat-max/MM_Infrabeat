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
import { priorityFor } from './requisition-priority.js';

export const OVERDUE_HOURS = 24;

function round1(n) {
  return Math.round(n * 10) / 10;
}

// What the company actually pays: the goods plus getting them here.
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
    supplierName: score ? score.name : 'Unknown vendor',
    supplierScore: score,
    percentOverContract,
    isOverdue: document.hoursWaiting > OVERDUE_HOURS,
    advice: buildAdvice(document, score),
    consequence: buildConsequence(document, score, material, contract),
    // Only requisitions carry this. An order is judged on its own terms - price, vendor,
    // what it commits. A requisition is judged on what the plant is about to run out of,
    // which is a fact about the yard rather than about the document.
    priority: document.kind === 'PR' ? priorityFor(document, materials) : null
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
