// Raising a new document: what number it gets, and who has to approve it.
//
// This is the counterpart to approvals.js. That file decides what happens to a document
// once somebody acts on it; this one decides what a document looks like the moment it is
// born. Both are business rules rather than plumbing, which is why they live here and not
// in a route.
//
// Nothing in this file talks to a store, a provider or SAP. It is given the documents that
// already exist and returns a plain object, so the same rule produces the same chain
// whether it is being written to a workbook, to SQLite or to nothing at all in a test.

// --- Numbering ---------------------------------------------------------------

// The seeded documents use SAP's own shape: purchase orders begin 45, requisitions begin
// 10, and both are ten digits. A new document follows the convention rather than inventing
// one, because a person reading the workbook should not be able to tell which rows the
// dashboard created and which came from the seed.
const PREFIX = { PO: '45', PR: '10' };

export function numberPrefixFor(kind) {
  return PREFIX[kind] || PREFIX.PO;
}

// The next number in the series, one above the highest already in use.
//
// Highest rather than count: deleting a row must never hand its number to a later
// document, because the number is what every mail, log line and approval refers to. Two
// documents sharing one would be worse than a gap in the sequence.
export function nextDocumentNumber(kind, existingIds) {
  const prefix = numberPrefixFor(kind);
  let highest = 0;

  for (const id of existingIds || []) {
    const text = String(id || '').trim();
    if (!text.startsWith(prefix) || !/^\d+$/.test(text)) continue;
    const value = Number(text);
    if (Number.isSafeInteger(value) && value > highest) highest = value;
  }

  // Nothing in the series yet, so start it. The trailing digits are arbitrary; what
  // matters is the prefix and the width.
  if (highest === 0) return `${prefix}00000001`;

  return String(highest + 1);
}

// --- Who approves it ---------------------------------------------------------

// The manager's own authority, from their record in the account panel: release code 02,
// orders up to five crore. Anything at or above the upper band is beyond what they can
// release alone and needs a director, whatever else is true of it.
export const APPROVAL_BANDS = {
  // A purchase order the manager can release on their own signature.
  poAlone: 10000000, // one crore
  // Above this the manager cannot release it at all: it goes to the director.
  poDirector: 50000000 // five crore, the release limit
};

// A requisition is a request to buy, not a commitment, so it carries a lower bar: small
// ones the manager closes, larger ones go to the head of procurement for release.
export const PR_ALONE_LIMIT = 1000000; // ten lakh

// The people a document can be sent to. Names must match MAIL_DIRECTORY in .env exactly,
// because that is what turns a name into a mailbox - see domain/recipients.js.
export const APPROVERS = {
  financeHead: { name: 'Mr. Kiran Raghavan', title: 'Finance head', level: 'Step 2 of 2, final' },
  director: { name: 'Mr. Sunil Kulkarni', title: 'Director, Operations', level: 'Step 2 of 2, final' },
  procurementHead: { name: 'Mr. Anil Deshmukh', title: 'Head of Procurement', level: 'Release step, final' }
};

// Works out the approval chain for a document about to be raised.
//
// Returns the two things a document needs to enter the flow:
//   step  the label for where it sits now, which is always the first step
//   next  who it goes to when this manager approves, or null when they finish it
//
// The shape is deliberately the same as what approvals.js reads, so a created document is
// indistinguishable from a seeded one the moment it is saved. That is the whole point: no
// screen, mail or rule needs to know where a document came from.
export function chainFor({ kind, basic }) {
  const value = Number(basic) || 0;

  if (kind === 'PR') {
    if (value < PR_ALONE_LIMIT) {
      return { step: 'Step 1 of 1', next: null };
    }
    return { step: 'Purchasing step', next: { ...APPROVERS.procurementHead } };
  }

  if (value < APPROVAL_BANDS.poAlone) {
    return { step: 'Step 1 of 1', next: null };
  }

  if (value < APPROVAL_BANDS.poDirector) {
    return { step: 'Step 1 of 2', next: { ...APPROVERS.financeHead } };
  }

  return { step: 'Step 1 of 2', next: { ...APPROVERS.director } };
}

// Says in one sentence why the chain came out the way it did.
//
// Shown on the create form as the value is typed, so nobody has to guess why a document
// will need a second signature - and so a surprising chain is questioned before the
// document exists rather than after it has been mailed to a director.
export function chainExplanation({ kind, basic }) {
  const value = Number(basic) || 0;
  const { next } = chainFor({ kind, basic });

  if (!next) {
    return kind === 'PR'
      ? 'Under ten lakh, so you can release this requisition yourself.'
      : 'Under one crore, so you can release this order yourself.';
  }

  if (kind === 'PR') {
    return `Ten lakh or more, so it goes to ${next.name} for release after you.`;
  }

  return value >= APPROVAL_BANDS.poDirector
    ? `Above your five crore release limit, so it goes to ${next.name} after you.`
    : `One crore or more, so it goes to ${next.name} after you.`;
}
