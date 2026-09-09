// What an approval actually does to a document.
//
// Until now this was one line in the route: approve meant approved, full stop. That is only
// true of a document whose approval is the last one. On a two step order it was wrong, and
// wrong in the expensive direction - it marked an order finished that nobody senior had
// seen, and told the buyer it was done.
//
// The rule is small enough to state in a sentence: approving a document that has somebody
// after you does not finish it, it moves it to them. Sending one back finishes it whatever
// the chain says, because there is no point asking the next person about an order that has
// already been refused.
//
// It lives in its own file, away from routes and mail and storage, because it is the one
// piece here that is a business rule rather than plumbing. Everything else in this feature
// exists to carry out what these twenty lines decide.

// Has this manager already dealt with the document?
//
// A document can be pending and yet not be theirs to act on: they approved it, and it moved
// to the next person. decidedAt is what separates "waiting for you" from "you have signed,
// it is with somebody else now".
export function alreadyDecided(document) {
  return Boolean(document.decidedAt);
}

// True only when the buttons should work.
export function canDecide(document) {
  return document.status === 'pending' && !alreadyDecided(document);
}

// The single decision this feature turns on.
//
// Returns:
//   status    what the document becomes: still pending, approved, or rejected
//   final     whether this is the end of the road for it
//   movedTo   the approver it has gone to, or null
//   step      the approval step it now sits at
export function outcomeOf(document, action) {
  if (action === 'reject') {
    return { status: 'rejected', final: true, movedTo: null, step: document.step };
  }

  // Approved, but somebody comes after them: the document keeps waiting, one step further
  // along. This is the whole change.
  if (document.next && document.next.name) {
    return { status: 'pending', final: false, movedTo: document.next, step: document.next.level || document.step };
  }

  return { status: 'approved', final: true, movedTo: null, step: document.step };
}

// One sentence saying where the document stands, written for the person who raised it
// rather than for a procurement team. Used as the opening line of their mail and as the
// caption under the chain on screen, so the two can never drift apart.
export function outcomeSentence(document, outcome, decidedBy) {
  const what = `${document.kind} ${document.id}`;

  if (outcome.status === 'rejected') {
    return `${what} has been sent back by ${decidedBy}. It has not gone any further.`;
  }

  if (outcome.final) {
    return `${what} has been approved by ${decidedBy}. That was the last approval, so it is now released.`;
  }

  return (
    `${what} has been approved by ${decidedBy} and passed to ${outcome.movedTo.name}` +
    `${outcome.movedTo.title ? `, ${outcome.movedTo.title}` : ''}, for ${outcome.movedTo.level || 'the next approval'}. ` +
    `Nothing is needed from you.`
  );
}
