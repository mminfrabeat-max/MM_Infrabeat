// Which vendor to buy a material from, and the reason.
//
// The fourth business rule, alongside approvals.js, creation.js and shipment.js. Those
// decide what happens to a document; this one helps decide what the document should say
// before it exists.
//
// It is a recommendation and nothing more. Nothing here places an order, and the ranking
// deliberately shows its working rather than returning a single name: a vendor with the
// best score can still be the wrong choice this week, and the person deciding knows things
// this data does not - a phone call this morning, a plant visit, a relationship. The job is
// to put the record in front of them, not to make the call for them.
//
// Everything below is read from orders that have actually completed. There is no market
// data, no quotations and no price discovery here, because the dashboard has none of those.

// What "good" means, in the order it matters for a cement plant.
//
// Delivery first. A kiln that stops because a load is late costs more than any rate
// difference on that load, which is why on-time weighs more than price. Quality next,
// because rejected material is a late delivery that also wasted a lorry. Rate last - it is
// the number everybody looks at first and the one that matters least when the alternative
// is a cold kiln.
const WEIGHTS = {
  onTime: 0.45,
  quality: 0.3,
  rate: 0.25
};

// Turns a vendor's record into one number between 0 and 100, for ordering a list.
//
// Deliberately not the same as the vendor's own score on the Vendors screen: that one
// judges a vendor in general, this one judges them as a choice for a purchase about to be
// made, so it leans harder on delivery and ignores things like how long they have been on
// the books.
export function suitability(vendor) {
  if (!vendor || !vendor.scored) return null;

  const onTime = Math.max(0, Math.min(100, Number(vendor.onTimePercent) || 0));
  const quality = Math.max(0, Math.min(100, Number(vendor.averageQuality) || 0));

  // Over contract is bad, under is good, and the scale is deliberately steep: five percent
  // over contract is a serious matter on a crore order.
  const over = Number(vendor.percentOverContract) || 0;
  const rate = Math.max(0, Math.min(100, 100 - over * 6));

  return Math.round(onTime * WEIGHTS.onTime + quality * WEIGHTS.quality + rate * WEIGHTS.rate);
}

// The one sentence that says why this vendor is where it is in the list.
//
// Written as the thing a person would actually say about them, and always naming the worst
// fact as well as the best. A recommendation that only lists strengths is advertising.
export function verdictFor(vendor) {
  if (!vendor || !vendor.scored) {
    return 'No completed orders yet, so there is nothing to judge them on.';
  }

  const parts = [];
  const onTime = Number(vendor.onTimePercent) || 0;
  const late = Number(vendor.averageDaysLate) || 0;
  const quality = Number(vendor.averageQuality) || 0;
  const over = Number(vendor.percentOverContract) || 0;

  if (onTime >= 70) parts.push(`on time ${onTime}% of the time`);
  else if (onTime >= 40) parts.push(`on time only ${onTime}% of the time, ${late} days late on average`);
  else parts.push(`almost never on time — ${onTime}%, averaging ${late} days late`);

  if (quality >= 99) parts.push('quality is excellent');
  else if (quality >= 97) parts.push(`quality ${quality}%`);
  else parts.push(`quality ${quality}%, which is poor`);

  if (over > 3) parts.push(`and ${over}% over contract rate`);
  else if (over > 0) parts.push(`${over}% over contract`);
  else parts.push('at or under contract rate');

  if (vendor.trend === 'worsening') parts.push('and getting worse');
  else if (vendor.trend === 'improving') parts.push('and improving');

  return `${parts.join(', ')}.`;
}

// Everybody who could supply this material, best choice first.
//
// Two ways in, and the difference is worth keeping visible to whoever reads the list:
//
//   used before  - this vendor has actually supplied this exact material. The strongest
//                  evidence there is, whatever the numbers say.
//   same trade   - they supply this category of thing but not this material. A real
//                  option, and an untested one.
//
// A vendor nobody has completed an order with is included but never recommended: there is
// no record to recommend them on, and saying so is more useful than hiding them.
export function vendorsFor(material, vendors, documents) {
  if (!material) return [];

  const usedBefore = new Set(
    documents
      .filter((d) => d.materialCode === material.code && d.supplierId)
      .map((d) => d.supplierId)
  );

  // The category the material's usual vendor trades in, which is how an alternative is
  // recognised at all. Without a usual vendor there is nothing to compare against, so the
  // list is just whoever has supplied it.
  const usual = vendors.find((v) => v.name === material.supplierName);
  const category = usual?.category || null;

  const candidates = vendors.filter(
    (v) => usedBefore.has(v.supplierId) || (category && v.category === category)
  );

  return candidates
    .map((vendor) => ({
      vendor,
      used: usedBefore.has(vendor.supplierId),
      usual: vendor.name === material.supplierName,
      score: suitability(vendor),
      verdict: verdictFor(vendor)
    }))
    .sort((a, b) => {
      // Unscored vendors always sit at the bottom: there is nothing to rank them on.
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
}

// The recommendation itself: who to use, and whether it is a change from what is being done.
//
// The interesting case is when the best option is not the usual one, because that is the
// only time this is worth telling somebody. When they agree, saying so plainly is better
// than manufacturing a reason to switch.
export function recommendFor(material, vendors, documents) {
  const ranked = vendorsFor(material, vendors, documents);
  if (ranked.length === 0) return null;

  const scored = ranked.filter((r) => r.score !== null);
  if (scored.length === 0) {
    return { material, ranked, best: null, usual: ranked.find((r) => r.usual) || null, changes: false };
  }

  const best = scored[0];
  const usual = ranked.find((r) => r.usual) || null;

  return {
    material,
    ranked,
    best,
    usual,
    // Worth raising only when there is a usual vendor, it is not the best, and the gap is
    // big enough to be a real difference rather than noise in a small sample.
    changes: Boolean(usual && !best.usual && best.score - (usual.score ?? 0) >= 10)
  };
}
