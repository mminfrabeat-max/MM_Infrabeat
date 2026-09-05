// Turns a supplier's last ten orders into a single reliability score out of 100.
//
// This lives in the backend, not the browser, on purpose. It is a business rule. If the
// company later decides quality should count for more than delivery, that is one edit
// here and every screen changes at once. Rules in the frontend get copied and drift.
//
// The weights are a starting point, not a law. They are written as named constants so a
// customer can argue with them, which is the right conversation to be having.

const WEIGHT_DELIVERY = 0.4;
const WEIGHT_QUALITY = 0.35;
const WEIGHT_RATE = 0.25;

// A supplier whose recent orders are clearly worse than their older ones loses points on
// top of the averages. Direction matters more than the average when you are about to
// sign the next order.
const WORSENING_PENALTY = 10;
const WORSENING_THRESHOLD_DAYS = 1;

// How many orders count as "recent" and "earlier" when comparing the two ends.
const TREND_WINDOW = 3;

// A delivery within this many days of the promised date counts as on time.
//
// Without a grace window, a supplier who is reliably one day late scores 0 percent on
// time, which sits absurdly next to an otherwise good overall score. One day of slack
// matches how a plant actually works, and it is the same allowance most supplier
// scorecards use. Raise it to 0 for a strict reading.
const ON_TIME_TOLERANCE_DAYS = 1;

function average(numbers) {
  if (numbers.length === 0) return 0;
  const total = numbers.reduce((sum, n) => sum + n, 0);
  return total / numbers.length;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// An early delivery is not a bonus, it is just not late. Without this, one very early
// delivery would cancel out a very late one and the average would flatter the supplier.
function latenessOnly(daysLate) {
  return Math.max(0, daysLate);
}

export function scoreSupplier(supplier, history) {
  // A supplier with no history cannot be scored. Say so rather than inventing a number.
  if (!history || history.length === 0) {
    return {
      supplierId: supplier.id,
      name: supplier.name,
      category: supplier.category,
      unit: supplier.unit,
      contractRate: supplier.contractRate,
      history: [],
      scored: false,
      reasonNotScored: 'No completed orders yet'
    };
  }

  const orderCount = history.length;
  const onTimeCount = history.filter((o) => o.daysLate <= ON_TIME_TOLERANCE_DAYS).length;
  const averageDaysLate = average(history.map((o) => latenessOnly(o.daysLate)));
  const averageQuality = average(history.map((o) => o.qualityPercent));

  // Rate comparison uses the most recent order, because that is what the supplier is
  // charging now. An average would hide a recent increase, which is the thing we care about.
  const latestRate = history[orderCount - 1].rate;
  const percentOverContract =
    ((latestRate - supplier.contractRate) / supplier.contractRate) * 100;

  const recent = history.slice(-TREND_WINDOW);
  const earlier = history.slice(0, TREND_WINDOW);
  const recentDaysLate = average(recent.map((o) => latenessOnly(o.daysLate)));
  const earlierDaysLate = average(earlier.map((o) => latenessOnly(o.daysLate)));
  const isWorsening = recentDaysLate > earlierDaysLate + WORSENING_THRESHOLD_DAYS;
  const isImproving = recentDaysLate < earlierDaysLate - WORSENING_THRESHOLD_DAYS;

  // Each of the three parts becomes a 0-100 figure before the weights are applied.
  // Delivery: every day of average lateness costs 9 points.
  const deliveryPoints = Math.max(0, 100 - averageDaysLate * 9);
  // Quality: 90 percent accepted scores 0, 100 percent scores 100.
  const qualityPoints = Math.max(0, (averageQuality - 90) * 10);
  // Rate: only being ABOVE contract costs points. Coming in under contract is not a bonus,
  // because a suspiciously cheap supplier is not automatically a better one.
  const ratePoints = Math.max(0, 100 - Math.max(0, percentOverContract) * 8);

  const weighted =
    deliveryPoints * WEIGHT_DELIVERY +
    qualityPoints * WEIGHT_QUALITY +
    ratePoints * WEIGHT_RATE;

  const total = Math.max(0, Math.round(weighted - (isWorsening ? WORSENING_PENALTY : 0)));

  return {
    supplierId: supplier.id,
    name: supplier.name,
    category: supplier.category,
    unit: supplier.unit,
    contractRate: supplier.contractRate,
    history,
    scored: true,
    orderCount,
    onTimePercent: Math.round((onTimeCount / orderCount) * 100),
    // Sent to the screen so the label can say what "on time" actually means here,
    // rather than leaving the manager to assume it means "to the day".
    onTimeToleranceDays: ON_TIME_TOLERANCE_DAYS,
    averageDaysLate: round1(averageDaysLate),
    averageQuality: round1(averageQuality),
    latestRate,
    percentOverContract: round1(percentOverContract),
    recentDaysLate: round1(recentDaysLate),
    earlierDaysLate: round1(earlierDaysLate),
    trend: isWorsening ? 'worsening' : isImproving ? 'improving' : 'steady',
    total,
    band: bandFor(total),
    bandLabel: bandLabelFor(total)
  };
}

// Three bands, so the manager sees one of three words instead of doing arithmetic.
function bandFor(total) {
  if (total >= 80) return 'good';
  if (total >= 60) return 'watch';
  return 'risk';
}

function bandLabelFor(total) {
  if (total >= 80) return 'Preferred';
  if (total >= 60) return 'Watch';
  return 'At risk';
}

// Scores every supplier at once, and returns them keyed by id so a document can find
// its own supplier without searching the list each time.
export function scoreAllSuppliers(suppliers, historyBySupplier) {
  const byId = {};
  for (const supplier of suppliers) {
    byId[supplier.id] = scoreSupplier(supplier, historyBySupplier[supplier.id]);
  }
  return byId;
}

// The supplier most in need of attention. Used for the headline on the Today screen.
export function lowestScoring(scoresById) {
  const scored = Object.values(scoresById).filter((s) => s.scored);
  if (scored.length === 0) return null;
  return scored.reduce((worst, s) => (s.total < worst.total ? s : worst));
}
