// A walk through the tabs, for somebody opening this for the first time.
//
// It navigates rather than describes. Each step moves to the screen it is talking about and
// says what that screen is for in two sentences, so the tour is spent looking at the real
// dashboard with the real numbers on it rather than at pictures of one. Somebody who stops
// half way through has still arrived somewhere useful.
//
// The card sits in a corner and does not point at anything. Pointing is tempting - an arrow
// at the exact button reads well in a screenshot - but it means measuring a moving target,
// and an arrow that lands two inches from what it means is worse than no arrow. The screen
// itself is the illustration; the card only has to say what to look at.
//
// It appears by itself once, and never again unless the question mark is pressed.

import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

const SEEN = 'infrabeat.tour.seen';

// Browsers can refuse local storage entirely - a private window, or settings that block
// it - and it must not take the dashboard down with it. Refusing means the tour opens
// every time, which is a smaller problem than a blank screen.
function seenBefore() {
  try {
    return window.localStorage.getItem(SEEN) === 'yes';
  } catch {
    return true;
  }
}

function rememberSeen() {
  try {
    window.localStorage.setItem(SEEN, 'yes');
  } catch {
    // Nothing to do. It will offer itself again next time, and that is survivable.
  }
}

export const STEPS = [
  {
    tab: 'overview',
    title: 'Start here each morning',
    text:
      'One paragraph saying what is waiting, what runs short first, and what it is worth. ' +
      'The three boxes under it are the most urgent things on your desk, biggest first.'
  },
  {
    tab: 'approvals',
    title: 'Orders waiting for your signature',
    text:
      'Every purchase order that needs approving, most urgent at the top. Search by number, ' +
      'vendor or material, and narrow by period or status. Open any row to see the full order.'
  },
  {
    tab: 'requisitions',
    title: 'Requisitions waiting for your signature',
    text:
      'The same, for requests from the plants. Ranked by what runs dry first, not by what ' +
      'arrived first: a small request for something with four days of cover beats a large one ' +
      'for something with four weeks.'
  },
  {
    tab: 'shipments',
    title: 'Where released orders have got to',
    text:
      'From telling the vendor through to the material arriving. Put in a tracking number and ' +
      'the map follows the load. Mark each stage as it happens.'
  },
  {
    tab: 'stock',
    title: 'What is about to run out',
    text:
      'Days of cover against the lead time for a new load. Where cover is shorter than the ' +
      'lead time, the plant runs dry even if you approve today - that is what makes a ' +
      'requisition critical.'
  },
  {
    tab: 'open',
    title: 'Orders and contracts still open',
    text:
      'What is committed and how much of each contract has been used. A contract running out ' +
      'mid-quarter is worth knowing before the next order is placed against it.'
  },
  {
    tab: 'suppliers',
    title: 'How vendors have actually performed',
    text:
      'A score built from their delivery record, quality and rate against contract - and the ' +
      'arithmetic is shown, so you can disagree with it. Search by name or vendor number, and ' +
      'request a new vendor from the same card.'
  },
  {
    tab: 'team',
    title: 'Who owes what',
    text:
      'Four managers and the work sitting with each of them, taken from the documents rather ' +
      'than a task list. The bandwidth bar says whether anything more can go to them today.'
  },
  {
    tab: 'situations',
    title: 'Things worth a second look',
    text:
      'Where the data disagrees with itself, or a number is worse than it first appears. Each ' +
      'one explains what it found and what to do about it.'
  },
  {
    tab: null,
    title: 'Or just ask',
    text:
      'The Ask button at the top answers questions about any of this - what is late, what is ' +
      'short, who is holding an order. It can also send a reminder or export a list, and it ' +
      'shows you what it is about to do before it does it.'
  }
];

export function TourButton({ onClick, hidden }) {
  if (hidden) return null;
  return (
    // A compass rather than a question mark. A question mark offers to answer a question
    // you have already got; this offers to show you round, which is the thing on the other
    // side of it. Swap the line below back to a plain ? if the mark reads better.
    <button className="tourbtn" type="button" onClick={onClick} aria-label="Show me around">
      <Icon name="compass" size={27} />
    </button>
  );
}

export default function Tour({ open, onClose, onGoTo }) {
  const [at, setAt] = useState(0);

  // Each step drives the dashboard to the screen it describes, so what is being read about
  // is what is on the screen behind it.
  useEffect(() => {
    if (!open) return;
    const step = STEPS[at];
    if (step?.tab) onGoTo(step.tab);
  }, [at, open, onGoTo]);

  // Arrow keys and Escape, because a walkthrough somebody is clicking through ten times is
  // a walkthrough they will want to get out of quickly.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') setAt((n) => Math.min(n + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setAt((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function finish() {
    rememberSeen();
    setAt(0);
    onClose();
  }

  if (!open) return null;

  const step = STEPS[at];
  const last = at === STEPS.length - 1;

  return (
    <aside className="tour" aria-label="Guided tour">
      <div className="tourhd">
        <span className="tourn">
          Step {at + 1} of {STEPS.length}
        </span>
        <button className="tourx" type="button" onClick={finish} aria-label="Close the tour">
          &times;
        </button>
      </div>

      <h3>{step.title}</h3>
      <p>{step.text}</p>

      {/* One mark per step, filled as far as you have got. A bar would say the same thing
          less precisely - with ten steps you can count the dots. */}
      <div className="tourdots">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            className={`tourdot${i === at ? ' on' : ''}${i < at ? ' past' : ''}`}
            onClick={() => setAt(i)}
            aria-label={`Step ${i + 1}: ${s.title}`}
          />
        ))}
      </div>

      <div className="tourft">
        <button className="btn q" type="button" onClick={finish}>
          {last ? 'Close' : 'Skip'}
        </button>
        <span style={{ flex: 1 }} />
        {at > 0 && (
          <button className="btn q" type="button" onClick={() => setAt(at - 1)}>
            Back
          </button>
        )}
        <button
          className="btn emph"
          type="button"
          onClick={() => (last ? finish() : setAt(at + 1))}
        >
          {last ? 'Done' : 'Next'}
          {!last && <Icon name="chevron" size={13} />}
        </button>
      </div>
    </aside>
  );
}

// Whether to open it unasked. Only ever true once per browser.
export function shouldOfferTour() {
  return !seenBefore();
}
