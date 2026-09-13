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
// Where a document stands, and separately, whose turn it is.
//
// These were one thing and should never have been. "Partially approved" is a fact about
// the document - somebody has signed it and it is not finished - and it is true whichever
// side of the signature you are standing on. An order signed at step one and passed to you
// is exactly as partly approved as one you signed and passed to somebody else; reporting
// the first as "Pending" told the reader the opposite of what the page below it showed,
// which lists the person who signed under "Who has approved so far".
//
// Whose turn it is, is a different question with a different answer, and it now has its
// own field. Anything that wants to know "is this mine" reads `withYou`; anything that
// wants to describe the document reads `state`.
export function approvalStateOf(document) {
  if (document.status === 'approved') {
    return {
      state: 'approved',
      label: 'Approved',
      holder: null,
      holderTitle: null,
      withYou: false,
      signedBy: document.decidedBy || '',
      signedAt: document.decidedAt || ''
    };
  }

  if (document.status === 'rejected') {
    return {
      state: 'rejected',
      label: 'Rejected',
      holder: null,
      holderTitle: null,
      withYou: false,
      signedBy: document.decidedBy || '',
      signedAt: document.decidedAt || ''
    };
  }

  // Still open. Whose desk is it on? Yours until you have signed, then the next approver’s.
  const passedOn = alreadyDecided(document) && Boolean(document.next && document.next.name);
  const holder = passedOn ? document.next.name : null;
  const holderTitle = passedOn ? document.next.title || '' : '';

  // One signature is enough to make it partly approved, from either side: one you gave, or
  // one already on it when it reached you. `prev` is that earlier signature - it is what the
  // order page lists under "Who has approved so far".
  const signedAlready = alreadyDecided(document) || Boolean(document.prev && document.prev.name);

  return {
    state: signedAlready ? 'partial' : 'waiting',
    label: signedAlready ? 'Partially approved' : 'Pending',
    holder,
    holderTitle,
    // Yours to sign, or somebody else’s. Note that a partly approved document can still be
    // yours: that is the whole point of the change.
    withYou: !passedOn,
    signedBy: document.decidedBy || (document.prev && document.prev.name) || '',
    signedAt: document.decidedAt || (document.prev && document.prev.when) || ''
  };
}

export function outcomeSentence(document, outcome, decidedBy) {
  const what = `${document.kind} ${document.id}`;

  if (outcome.status === 'rejected') {
    return `${what} has been rejected by ${decidedBy}. It has not gone any further.`;
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
