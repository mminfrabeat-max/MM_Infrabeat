// Builds the Today screen: one plain-language summary line, the three things that need
// the manager before noon, and the headline numbers.
//
// This is the file that decides what "important" means, so it is worth reading slowly.
// Ranking is by consequence, not by category:
//   1. Approvals overdue      - money is sitting still and someone is waiting
//   2. Stock that runs out    - production stops, which costs more than any order
//   3. Supplier getting worse - about to be locked in by an approval waiting right now

import { money, plural } from './format.js';
import { OVERDUE_HOURS, byLongestWait, totalValue } from './documents.js';

export function buildToday({ documents, materials, scoresById, worstSupplier, situations }) {
  const pending = documents.filter((d) => d.status === 'pending');
  const overdue = byLongestWait(pending.filter((d) => d.isOverdue));
  const atRisk = materials.filter((m) => m.willRunOut);
  const belowReorder = materials.filter((m) => m.belowReorderPoint);
  const openSituations = situations.filter((s) => s.status === 'open');

  const valueHeld = totalValue(pending);
  const valueOverdue = totalValue(overdue);

  // The document that the worst supplier is waiting on, if there is one. This is what
  // makes the supplier warning actionable rather than trivia.
  const worstSupplierDocument = worstSupplier
    ? pending.find((d) => d.supplierId === worstSupplier.supplierId)
    : null;

  return {
    greeting: 'Good morning, Rajeev',
    summary: buildSummaryLine({ overdue, valueOverdue, atRisk, worstSupplier }),
    decisions: buildDecisions({ overdue, atRisk, worstSupplier, worstSupplierDocument }),
    headline: {
      pendingCount: pending.length,
      overdueCount: overdue.length,
      valueHeld,
      valueOverdue,
      // What share of the waiting money is already past the limit. Drives the ring.
      overdueShare: valueHeld > 0 ? valueOverdue / valueHeld : 0,
      openSituationCount: openSituations.length,
      autoFixableCount: openSituations.filter((s) => s.canAutoFix).length,
      belowReorderCount: belowReorder.length,
      atRiskCount: atRisk.length,
      worstSupplierScore: worstSupplier ? worstSupplier.total : null,
      worstSupplierName: worstSupplier ? worstSupplier.name : null,
      worstSupplierTrend: worstSupplier ? worstSupplier.trend : null
    }
  };
}

// The one sentence at the top. Written so it still reads correctly when the counts are
// zero, because a dashboard that says "0 approvals past 24 hours" on a good day is fine,
// but one that says "undefined approvals" is not.
function buildSummaryLine({ overdue, valueOverdue, atRisk, worstSupplier }) {
  const parts = [];

  if (overdue.length > 0) {
    parts.push(
      `${plural(overdue.length, 'approval')} past ${OVERDUE_HOURS} hours holding ${money(valueOverdue)}`
    );
  }
  if (atRisk.length > 0) {
    parts.push(
      `${plural(atRisk.length, 'material')} that run out before a delivery could arrive`
    );
  }
  if (worstSupplier && worstSupplier.percentOverContract > 0) {
    parts.push(
      `${worstSupplier.name} charging ${worstSupplier.percentOverContract} percent above the agreed rate on an order waiting for approval`
    );
  }

  if (parts.length === 0) {
    return 'Nothing needs you this morning. No approvals are overdue and every material has enough cover.';
  }

  const count =
    parts.length === 1
      ? 'One thing needs'
      : `${capitalise(numberWord(parts.length))} things need`;
  return `${count} you before noon. ${joinWithAnd(parts)}.`;
}

// The three cards. Each one names the problem and the single most useful detail.
function buildDecisions({ overdue, atRisk, worstSupplier, worstSupplierDocument }) {
  const decisions = [];

  if (overdue.length > 0) {
    const oldest = overdue[0];
    decisions.push({
      urgent: true,
      goTo: 'approvals',
      title: `${plural(overdue.length, 'approval')} past ${OVERDUE_HOURS} hours`,
      detail: `The oldest is ${oldest.id}, with ${oldest.heldWith} for ${oldest.hoursWaiting} hours`
    });
  }

  if (atRisk.length > 0) {
    const worst = atRisk[0];
    decisions.push({
      urgent: true,
      goTo: 'stock',
      title: `${plural(atRisk.length, 'material')} run out before restock`,
      detail: `${worst.name} has ${worst.daysOfCover} days of cover against a ${worst.leadTimeDays} day lead time`
    });
  }

  if (worstSupplier) {
    decisions.push({
      urgent: false,
      goTo: 'suppliers',
      title: `${worstSupplier.name} dropped to ${worstSupplier.total} out of 100`,
      detail: worstSupplierDocument
        ? `${worstSupplier.percentOverContract} percent above the agreed rate on an order worth ${money(worstSupplierDocument.value)}`
        : `Deliveries have gone from ${worstSupplier.earlierDaysLate} to ${worstSupplier.recentDaysLate} days late`
    });
  }

  return decisions;
}

function numberWord(n) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);
}

// "a, b and c" rather than "a, b, c", so the sentence reads like English.
function joinWithAnd(parts) {
  if (parts.length === 1) return capitalise(parts[0]);
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1);
  return capitalise(`${rest.join(', ')} and ${last}`);
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
