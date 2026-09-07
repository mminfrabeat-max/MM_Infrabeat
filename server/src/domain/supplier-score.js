// Vendor standing, out of 100.
//
// This is NOT a score we invent from scratch. It starts from SAP's own vendor evaluation
// figure and then adjusts it, which matters: procurement people already trust that
// number and argue with anything that contradicts it without explanation.
//
// Two adjustments, both downward, both explainable in one sentence to a buyer:
//   - the vendor is getting later than they used to be
//   - the vendor is charging above the agreed contract rate
//
// A vendor who used to be good and is slipping matters more than the average shows,
// which is why direction is penalised rather than just averaged in.

// Points lost when recent deliveries are clearly worse than earlier ones.
const WORSENING_PENALTY = 14;
const WORSENING_THRESHOLD_DAYS = 1;

// Points lost per percent above the contract rate.
const RATE_PENALTY_PER_PERCENT = 1.1;

// How many orders count as "recent" and "earlier" when comparing the two ends.
const TREND_WINDOW = 3;

function average(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// An early delivery is not a bonus, it is just not late. Without this, one very early
// delivery would cancel out a very late one and the average would flatter the vendor.
function latenessOnly(daysLate) {
  return Math.max(0, daysLate);
}

export function scoreSupplier(supplier, history) {
  const base = {
    supplierId: supplier.id,
    name: supplier.name,
    category: supplier.category,
    city: supplier.city,
    gst: supplier.gst,
    iec: supplier.iec,
    unit: supplier.unit,
    contractRate: supplier.contractRate,
    sapScore: supplier.sapScore
  };

  // A vendor with no completed orders cannot be judged. Say so rather than inventing.
  if (!history || history.length === 0) {
    return { ...base, history: [], scored: false, reasonNotScored: 'No completed orders yet' };
  }

  const orderCount = history.length;
  const onTimeCount = history.filter((o) => o.daysLate <= 0).length;
  const averageDaysLate = average(history.map((o) => latenessOnly(o.daysLate)));
  const averageQuality = average(history.map((o) => o.qualityPercent));

  // The rate comparison uses the most recent order, because that is what the vendor is
  // charging now. An average would hide a recent increase, which is the thing we care about.
  const latestRate = history[orderCount - 1].rate;
  const percentOverContract =
    ((latestRate - supplier.contractRate) / supplier.contractRate) * 100;

  const recentDaysLate = average(history.slice(-TREND_WINDOW).map((o) => latenessOnly(o.daysLate)));
  const earlierDaysLate = average(history.slice(0, TREND_WINDOW).map((o) => latenessOnly(o.daysLate)));
  const isWorsening = recentDaysLate > earlierDaysLate + WORSENING_THRESHOLD_DAYS;
  const isImproving = recentDaysLate < earlierDaysLate - WORSENING_THRESHOLD_DAYS;

  const penalty =
    (isWorsening ? WORSENING_PENALTY : 0) +
    Math.round(Math.max(0, percentOverContract) * RATE_PENALTY_PER_PERCENT);

  const total = Math.max(0, supplier.sapScore - penalty);

  return {
    ...base,
    history,
    scored: true,
    orderCount,
    onTimePercent: Math.round((onTimeCount / orderCount) * 100),
    averageDaysLate: round1(averageDaysLate),
    averageQuality: round1(averageQuality),
    latestRate,
    percentOverContract: round1(percentOverContract),
    recentDaysLate: round1(recentDaysLate),
    earlierDaysLate: round1(earlierDaysLate),
    // Shown on screen so the adjustment is never a mystery.
    penalty,
    trend: isWorsening ? 'getting worse' : isImproving ? 'improving' : 'steady',
    total,
    band: bandFor(total),
    bandLabel: bandLabelFor(total)
  };
}

// Three bands, so the manager reads one of three words instead of doing arithmetic.
function bandFor(total) {
  if (total >= 80) return 'good';
  if (total >= 60) return 'watch';
  return 'risk';
}

function bandLabelFor(total) {
  if (total >= 80) return 'Good';
  if (total >= 60) return 'Watch';
  return 'Problem';
}

export function scoreAllSuppliers(suppliers, historyBySupplier) {
  const byId = {};
  for (const supplier of suppliers) {
    byId[supplier.id] = scoreSupplier(supplier, historyBySupplier[supplier.id]);
  }
  return byId;
}

export function lowestScoring(scoresById) {
  const scored = Object.values(scoresById).filter((s) => s.scored);
  if (scored.length === 0) return null;
  return scored.reduce((worst, s) => (s.total < worst.total ? s : worst));
}
