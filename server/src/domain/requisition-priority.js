// Which requisition to approve first.
//
// An order is judged on its own terms - is the price right, is the vendor sound. A
// requisition is different: it is a request for something the plant does not have enough
// of, so what makes one urgent is not what it says but what is happening in the yard.
// Approving them in the order they arrived is the one ordering that has nothing to do with
// that, which is why this file exists.
//
// The number that decides it is the gap between how long the stock lasts and how long a
// new load takes to arrive:
//
//     shortfall = days of cover - lead time
//
// A negative shortfall means the plant runs out before a replacement can land EVEN IF the
// requisition is approved this minute. Every day it then sits unapproved is another day
// added to that gap. Nothing else on the screen says that, and it is the only thing on the
// screen that cannot be recovered by working faster later.
//
// Everything here is read from the stock position the dashboard already computes. There is
// no forecasting and no guessing at demand.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

// Reads the dates people actually write: "29 Sep 2026", "25 Sep", "4 sep 2026".
//
// Returns null for anything that is not a date - "Rolling, monthly" is a real value in this
// data and means there is no single day to work to. Null is honest; guessing a date for it
// would put a standing arrangement in the middle of the urgent list.
export function parseWhen(text, today = new Date()) {
  const match = /(\d{1,2})\s+([A-Za-z]{3,})\.?\s*(\d{4})?/.exec(String(text || ''));
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  if (month === undefined || !day) return null;

  const year = match[3] ? Number(match[3]) : today.getFullYear();
  const when = new Date(year, month, day);

  // A bare "25 Sep" that has already gone by means next year, not eight months ago.
  if (!match[3] && when < today && today - when > 180 * 24 * 60 * 60 * 1000) {
    when.setFullYear(year + 1);
  }

  return Number.isNaN(when.getTime()) ? null : when;
}

function daysBetween(from, to) {
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

// The material this requisition is for, at the plant that asked for it.
//
// Matched on both, because the same material at two plants is two different stock
// positions: Nagpur can be weeks from running out while Pune has plenty.
export function materialFor(document, materials) {
  return (
    materials.find((m) => m.code === document.materialCode && m.plant === document.plant) ||
    materials.find((m) => m.code === document.materialCode) ||
    null
  );
}

// How urgent this requisition is, and why.
//
// `score` exists only to sort by; it is never shown. What is shown is the band and the
// reasons, because "approve this one first" is worth nothing to the person reading it
// unless they can see what it is they are being told.
export function priorityFor(document, materials, today = new Date()) {
  const material = materialFor(document, materials);

  const cover = Number(material?.daysOfCover);
  const lead = Number(material?.leadTimeDays);
  const shortBy = Number(material?.shortBy) || 0;
  const kiln = Boolean(material?.kiln);

  // The whole point of the file, in one line.
  const shortfallDays =
    Number.isFinite(cover) && Number.isFinite(lead) ? Math.round((cover - lead) * 10) / 10 : null;

  // When it is wanted. The requisition's own date if it has one, otherwise the date the
  // plant said it first needs the material.
  const wanted = parseWhen(document.deliveryDate, today) || parseWhen(material?.neededFrom, today);
  const daysUntilNeeded = wanted ? daysBetween(today, wanted) : null;

  const reasons = [];
  let score = 0;

  if (shortfallDays !== null && shortfallDays < 0) {
    score += Math.min(-shortfallDays, 30) * 4;
    reasons.push(
      `Runs out ${Math.abs(shortfallDays)} days before a new load could arrive — ` +
        `${cover} days of cover against a ${lead} day lead time.`
    );
  } else if (shortfallDays !== null && shortfallDays < 7) {
    score += (7 - shortfallDays) * 2;
    reasons.push(`Only ${shortfallDays} days of slack between cover and lead time.`);
  }

  if (daysUntilNeeded !== null) {
    score += Math.max(0, 30 - daysUntilNeeded) * 2;
    if (daysUntilNeeded < 0) reasons.push(`Was wanted ${Math.abs(daysUntilNeeded)} days ago.`);
    else if (daysUntilNeeded === 0) reasons.push('Wanted today.');
    else reasons.push(`Wanted in ${daysUntilNeeded} days.`);
  }

  if (shortBy > 0) {
    score += 10;
    reasons.push(`The plant is ${shortBy.toLocaleString('en-IN')} ${material.unit} short of what has been asked for.`);
  }

  if (kiln) {
    score += 15;
    reasons.push('The kiln runs on it.');
  }

  // A requisition nobody has looked at drifts up slowly, so nothing sits for ever just
  // because its material is comfortable. Capped, so age can never outrank running out.
  score += Math.min(Number(document.hoursWaiting) || 0, 120) / 12;

  const band =
    shortfallDays !== null && shortfallDays < 0 && shortBy > 0
      ? 'critical'
      : (shortfallDays !== null && shortfallDays < 7) || (daysUntilNeeded !== null && daysUntilNeeded <= 7)
        ? 'urgent'
        : daysUntilNeeded !== null && daysUntilNeeded <= 21
          ? 'soon'
          : 'routine';

  const label = {
    critical: 'Approve today',
    urgent: 'Approve this week',
    soon: 'Needed this month',
    routine: 'No date pressure'
  }[band];

  return {
    band,
    label,
    score: Math.round(score),
    shortfallDays,
    daysUntilNeeded,
    daysOfCover: Number.isFinite(cover) ? cover : null,
    leadTimeDays: Number.isFinite(lead) ? lead : null,
    shortBy,
    unit: material?.unit || document.unit || '',
    kiln,
    reasons
  };
}

// Most urgent first. Ties broken by value, because two requisitions equally pressing are
// not equally expensive to get wrong.
export function byPriority(documents) {
  return [...documents].sort((a, b) => {
    const difference = (b.priority?.score || 0) - (a.priority?.score || 0);
    if (difference !== 0) return difference;
    return (b.total || 0) - (a.total || 0);
  });
}
