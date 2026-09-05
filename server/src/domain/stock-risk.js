// Works out which materials will run out, and how urgent each one is.
//
// The important idea here is that "below the reorder point" and "will actually run out"
// are different questions, and only the second one stops production.
//
// Below reorder point  = a planning signal. Time to think about ordering.
// Cover < lead time    = a problem. Even if you order today, the delivery arrives after
//                        you have run out.
//
// A manager who only watches the reorder point gets surprised. That is why the screens
// lead with cover against lead time.

function round1(n) {
  return Math.round(n * 10) / 10;
}

// How many days of production the current position supports, counting what is already
// on order. A material with no consumption never runs out, so it gets a large number
// rather than a division by zero.
function daysOfCover(material) {
  if (!material.dailyUsage || material.dailyUsage <= 0) return 999;
  return (material.onHand + material.openOrderQuantity) / material.dailyUsage;
}

// The same figure ignoring what is on order. Worth showing alongside, because it answers
// "how exposed am I if that delivery slips?".
function daysOfCoverWithoutOrders(material) {
  if (!material.dailyUsage || material.dailyUsage <= 0) return 999;
  return material.onHand / material.dailyUsage;
}

// How much to order to get back to the reorder point and cover consumption while the
// delivery is in transit. Never negative.
function suggestedOrderQuantity(material) {
  const target =
    material.reorderPoint + material.dailyUsage * material.leadTimeDays;
  const have = material.onHand + material.openOrderQuantity;
  return Math.max(0, Math.ceil(target - have));
}

export function assessMaterial(material) {
  const cover = daysOfCover(material);
  const coverWithoutOrders = daysOfCoverWithoutOrders(material);
  const belowReorderPoint = material.onHand < material.reorderPoint;
  const willRunOut = cover < material.leadTimeDays;

  return {
    ...material,
    daysOfCover: round1(cover),
    daysOfCoverWithoutOrders: round1(coverWithoutOrders),
    belowReorderPoint,
    willRunOut,
    // One word for the manager, instead of two booleans to interpret.
    status: willRunOut ? 'runs out' : belowReorderPoint ? 'order soon' : 'healthy',
    suggestedOrderQuantity: suggestedOrderQuantity(material),
    // Only offer to order when it is below the reorder point and nothing is on the way.
    needsOrderNow: belowReorderPoint && material.openOrderQuantity === 0
  };
}

// Assesses every material and sorts the most urgent to the top, which is the order a
// manager wants to read them in.
export function assessAllMaterials(materials) {
  return materials
    .map(assessMaterial)
    .sort((a, b) => a.daysOfCover - b.daysOfCover);
}

export function materialsAtRisk(assessed) {
  return assessed.filter((m) => m.willRunOut);
}

export function materialsBelowReorderPoint(assessed) {
  return assessed.filter((m) => m.belowReorderPoint);
}
