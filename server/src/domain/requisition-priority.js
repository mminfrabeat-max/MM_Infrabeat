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

  // Four bands, named the way the business names them.
  //
  // The three things that decide it are the required date, the stock position and
  // whether the kiln runs on the material - but the date and the stock are not read
  // separately, because on their own neither answers the question. A material with
  // forty days of stock is comfortable until you learn the lead time is sixty, and
  // then it is already too late however far away the date is. So the figure that
  // decides the band is cover measured against lead time, which is the same question
  // the two columns ask, worked out rather than left to the reader.
  const band =
    shortfallDays !== null && shortfallDays < 0 && shortBy > 0
      ? 'critical'
      : (shortfallDays !== null && shortfallDays < 7) || (daysUntilNeeded !== null && daysUntilNeeded <= 7)
        ? 'high'
        : daysUntilNeeded !== null && daysUntilNeeded <= 21
          ? 'medium'
          : 'low';

  const label = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }[band];

  // What the band means for the person reading it. The name says how bad it is; this
  // says what to do about it, and a row that only ranks itself has told you nothing.
  const advice = {
    critical: 'Approve today',
    high: 'Approve this week',
    medium: 'Needed this month',
    low: 'No date pressure'
  }[band];

  // Shortage the way the business states it: what this requisition asks for against
  // what is on hand and already on order. Zero or less means the stock covers it.
  //
  // Deliberately not the same number as `shortBy`, which is the whole plant measured
  // against every department that has asked. Both are true and they answer different
  // questions, so they are named apart rather than one quietly standing for the other.
  const askedFor = Number(document.quantity) || 0;
  const stockAvailable = Number(material?.available);
  const shortageAgainstStock = Number.isFinite(stockAvailable)
    ? Math.max(0, Math.round((askedFor - stockAvailable) * 100) / 100)
    : null;

  return {
    band,
    label,
    advice,
    askedFor,
    stockAvailable: Number.isFinite(stockAvailable) ? stockAvailable : null,
    shortageAgainstStock,
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

// Most urgent first, but only among the ones that still need a decision.
//
// The list exists to answer "what should I approve next", so a requisition already
// released has no business competing for the top of it however short the material is.
// Three groups, in the order somebody works through them: waiting on you, then waiting on
// somebody else (chase those), then finished. Urgency orders within each group.
function actionGroup(document) {
  const state = document.approvalState?.state;
  if (state === 'waiting') return 0;
  if (state === 'partial') return 1;
  return 2;
}

// The band is what the row actually says - "Approve today", "Approve this week" - so it has
// to lead the ordering. Sorting by the raw score alone put a "this week" above a "today",
// which reads as the list contradicting itself however defensible the arithmetic was.
const BANDS = ['critical', 'high', 'medium', 'low'];

function bandRank(document) {
  const at = BANDS.indexOf(document.priority?.band);
  return at === -1 ? BANDS.length : at;
}

// Critical, then High, then Medium, then Low. Within a band, whichever is wanted soonest.
// Where two are wanted on the same day, the one with the bigger shortage goes first.
//
// Action state still leads all of it, and that is deliberate: a requisition already
// released has no business competing for the top of a list whose question is "what should
// I approve next", however short its material is. Waiting on you, then waiting on somebody
// else to chase, then finished - and the rule above orders each group.
export function byPriority(documents) {
  return [...documents].sort((a, b) => {
    const group = actionGroup(a) - actionGroup(b);
    if (group !== 0) return group;

    const band = bandRank(a) - bandRank(b);
    if (band !== 0) return band;

    // Soonest wanted first. A requisition with no date cannot claim to be urgent, so it
    // sorts behind every one that has a date rather than ahead of them.
    const whenA = a.priority?.daysUntilNeeded;
    const whenB = b.priority?.daysUntilNeeded;
    const dateA = whenA === null || whenA === undefined ? Infinity : whenA;
    const dateB = whenB === null || whenB === undefined ? Infinity : whenB;
    if (dateA !== dateB) return dateA - dateB;

    const shortA = a.priority?.shortageAgainstStock || 0;
    const shortB = b.priority?.shortageAgainstStock || 0;
    if (shortA !== shortB) return shortB - shortA;

    return (b.total || 0) - (a.total || 0);
  });
}
