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

// Whose signature the next click actually records.
//
// Not always this manager. Once they have approved, the document is sitting on the
// person after them, and that person does not sign in here - there is one login and it
// is the manager's. So the manager records what the next approver decided, and the step
// is stamped with THAT person's name.
//
// Stamping it with the manager's name instead would be the easy version and a lie: the
// log would say one person signed a document twice, and an audit trail that misnames
// who approved something is worse than not having one.
export function whoseTurn(document, manager) {
  if (!alreadyDecided(document)) return { name: manager, self: true };
  if (document.next && document.next.name) {
    return { name: document.next.name, title: document.next.title || '', self: false };
  }
  return { name: manager, self: true };
}

// True only when the buttons should work.
//
// A document is actionable while it is pending and somebody still has to sign it. That
// is either this manager, or - once they have signed - the approver it moved to.
export function canDecide(document) {
  if (document.status !== 'pending') return false;
  if (!alreadyDecided(document)) return true;
  return Boolean(document.next && document.next.name);
}

// True when the click would be recording somebody else's decision rather than making
// one. The screen says so on the button, because the two are not the same act.
export function isRecordingForNext(document) {
  return canDecide(document) && alreadyDecided(document);
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

  // The second signature finishes it. Once the approver it moved to has decided, there
  // is nobody after them in the chain, so the document is released rather than passed on
  // again - which would otherwise loop for ever against the same name.
  if (alreadyDecided(document)) {
    return { status: 'approved', final: true, movedTo: null, step: document.next?.level || document.step };
  }

  // Approved, but somebody comes after them: the document keeps waiting, one step further
  // along. This is the whole change.
  if (document.next && document.next.name) {
    return { status: 'pending', final: false, movedTo: document.next, step: document.next.level || document.step };
  }

  return { status: 'approved', final: true, movedTo: null, step: document.step };
}

// Where a document stands, and whose desk it is on.
//
// Four states, and the middle one is the whole reason this exists. "Pending" covers two
// completely different situations - nobody has signed it, and this manager has signed it
// and it has moved on - which look identical in storage and mean opposite things to the
// person reading a list. Telling them apart, and naming who is holding it, is the
// difference between a status column and a status column worth looking at.
//
// `holder` is null when it is the signed-in manager: the screen says "you", and the name
// of whoever is signed in is not this rule's business.
export function approvalStateOf(document) {
  if (document.status === 'approved') {
    return {
      state: 'approved',
      label: 'Approved',
      holder: null,
      holderTitle: null,
      signedBy: document.decidedBy || '',
      signedAt: document.decidedAt || ''
    };
  }

  if (document.status === 'rejected') {
    return {
      state: 'rejected',
      label: 'Sent back',
      holder: null,
      holderTitle: null,
      signedBy: document.decidedBy || '',
      signedAt: document.decidedAt || ''
    };
  }

  if (alreadyDecided(document) && document.next && document.next.name) {
    return {
      state: 'partial',
      label: 'Partially approved',
      holder: document.next.name,
      holderTitle: document.next.title || '',
      signedBy: document.decidedBy || '',
      signedAt: document.decidedAt || ''
    };
  }

  return {
    state: 'waiting',
    label: 'Pending',
    holder: null,
    holderTitle: null,
    signedBy: '',
    signedAt: ''
  };
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
