// Joins a purchase document to its supplier's score, and turns the two together into a
// recommendation the manager can act on without opening the ERP system.
//
// The recommendation is a business rule, so it lives here rather than in the browser.
// It never says "approve" flatly on a bad supplier and never blocks on a good one: the
// point is to put the supplier's recent behaviour in front of the person signing.

import { money, rupees } from './format.js';

// Anything waiting longer than this is treated as overdue on the Today screen.
export const OVERDUE_HOURS = 24;

function round1(n) {
  return Math.round(n * 10) / 10;
}

// How far this document's price sits above the agreed rate for THIS material.
// Note it uses the document's own contract rate, not the supplier's headline rate: a
// supplier sells several materials and each has its own agreed price.
function ratePosition(document) {
  if (!document.contractRate) return null;
  const percent =
    ((document.rate - document.contractRate) / document.contractRate) * 100;
  return round1(percent);
}

function buildRecommendation(document, score, percentOverContract) {
  // No history means no opinion. Saying so is more useful than a fake reassurance.
  if (!score || !score.scored) {
    return {
      verdict: 'check',
      text:
        `There are no completed orders for ${document.heldWith ? 'this supplier' : 'this supplier'} yet, ` +
        `so there is no delivery record to judge them on. Check the rate against the agreed price before approving.`
    };
  }

  if (score.band === 'good') {
    return {
      verdict: 'approve',
      text:
        `${score.name} hit the promised date on ${score.onTimePercent} percent of the last ten orders, ` +
        `quality ${score.averageQuality} percent, and the price matches the agreed rate. ` +
        `Nothing here needs a second look.`
    };
  }

  if (score.band === 'watch') {
    return {
      verdict: 'approve with a condition',
      text:
        `${score.name} runs ${score.averageDaysLate} days late on average and quality is ` +
        `${score.averageQuality} percent. Worth approving, but ask the buyer to agree a ` +
        `late delivery penalty before the order goes out.`
    };
  }

  return {
    verdict: 'hold',
    text:
      `${score.name} has slipped from ${score.earlierDaysLate} days late to ` +
      `${score.recentDaysLate} days late over the last ten orders` +
      (percentOverContract > 0
        ? `, and is charging ${percentOverContract} percent above the agreed rate of ${rupees(document.contractRate)} per ${document.unit}`
        : '') +
      `. Approving at ${money(document.value)} locks that in. Approve the quantity, but ` +
      `reopen the price against the agreement and get a firm delivery date first.`
  };
}

// One document plus everything needed to decide on it.
export function enrichDocument(document, scoresById) {
  const score = scoresById[document.supplierId] || null;
  const percentOverContract = ratePosition(document);

  return {
    ...document,
    supplierName: score ? score.name : 'Unknown supplier',
    supplierScore: score,
    percentOverContract,
    isOverdue: document.hoursWaiting > OVERDUE_HOURS,
    recommendation: buildRecommendation(document, score, percentOverContract)
  };
}

export function enrichAllDocuments(documents, scoresById) {
  return documents.map((d) => enrichDocument(d, scoresById));
}

export function pendingDocuments(documents) {
  return documents.filter((d) => d.status === 'pending');
}

// Longest wait first. That is the order a manager should work through them.
export function byLongestWait(documents) {
  return [...documents].sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

export function totalValue(documents) {
  return documents.reduce((sum, d) => sum + d.value, 0);
}
