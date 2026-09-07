// Which materials are short, and in what order to deal with them.
//
// The change that matters here: we no longer compare stock against a reorder point sitting
// in a master record. We compare it against what departments have actually asked for, by
// when. A material can be above its reorder point and still be short, because three
// departments between them want more than the reorder point ever assumed.
//
// Priority is worked out from four things, in the order a plant manager would weigh them:
//   1. Are we short against real demand at all
//   2. Will a new load arrive after we have run out
//   3. Does the kiln stop without it
//   4. How tight the days of cover are against the lead time

const SHORT_WEIGHT = 60;
const RUNS_OUT_WEIGHT = 25;
const KILN_WEIGHT = 10;
const TIGHTNESS_WEIGHT = 20;

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function assessMaterial(material) {
  const needs = material.needs || [];

  // Everything the departments between them have asked for.
  const totalNeeded = needs.reduce((sum, n) => sum + n.quantity, 0);
  // Everything we have or have coming.
  const available = material.onHand + material.openOrderQuantity;
  const shortBy = totalNeeded - available;

  const daysOfCover = material.dailyUsage > 0 ? available / material.dailyUsage : 99;
  // True when a load ordered today would arrive after we have run out.
  const runsOutFirst = daysOfCover < material.leadTimeDays;

  const tightness = Math.max(
    0,
    Math.round((1 - daysOfCover / Math.max(material.leadTimeDays, 1)) * TIGHTNESS_WEIGHT)
  );

  const urgency =
    (shortBy > 0 ? SHORT_WEIGHT : 0) +
    (runsOutFirst ? RUNS_OUT_WEIGHT : 0) +
    (material.kiln ? KILN_WEIGHT : 0) +
    tightness;

  // The date on the largest single demand. That is the one that actually bites.
  const biggestNeed = [...needs].sort((a, b) => b.quantity - a.quantity)[0];

  return {
    ...material,
    needs,
    totalNeeded,
    available,
    shortBy,
    daysOfCover: round1(daysOfCover),
    runsOutFirst,
    belowReorderPoint: material.onHand < material.reorderPoint,
    urgency,
    neededFrom: biggestNeed ? biggestNeed.by : null,
    band: shortBy > 0 ? 'risk' : runsOutFirst ? 'watch' : 'good',
    // How much to order: enough to cover the shortfall, or at least back to the
    // reorder point, whichever is larger.
    suggestedOrderQuantity: Math.max(
      Math.max(0, shortBy),
      Math.max(0, material.reorderPoint - material.onHand)
    )
  };
}

// Most urgent first, which is the order a manager wants to read them in.
export function assessAllMaterials(materials) {
  return materials.map(assessMaterial).sort((a, b) => b.urgency - a.urgency);
}

// Anything short against demand, or that runs out before a new load could land.
export function materialsShort(assessed) {
  return assessed.filter((m) => m.shortBy > 0 || m.runsOutFirst);
}
