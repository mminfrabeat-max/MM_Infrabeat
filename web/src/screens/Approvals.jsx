// The approval list. One row per document, with enough header detail to decide whether to
// open it at all.
//
// One screen, two tabs. Orders and requisitions are the same shape and are read the same
// way, but they are different decisions: a requisition asks whether something is needed
// at all, an order commits money to a named vendor. Splitting the list is what lets
// somebody clear all the small requisitions without the crore-value orders scrolling past
// in between - and the counts on the tabs then mean something on their own.

import { useState } from 'react';
import { inr, num, plural, firstName, loosely } from '../format.js';
import {
  PERIODS,
  APPROVAL_STATES,
  withinPeriod,
  matchesApprovalState,
  documentsOfKind,
  byPriority,
  byOrderPriority,
  sumTotals,
  requisitionAction,
  orderAction
} from '../selectors.js';
import { Card, Banner, Chip, Score, Icon, Count, StatBox, StatBand } from '../components/ui.jsx';
import { bandTone } from '../format.js';

// How urgent a requisition is, as a colour. The bands come from the server, which works
// them out from the stock position - see server/src/domain/requisition-priority.js.
function bandToneFor(priority) {
  if (!priority) return 'mut';
  if (priority.band === 'critical') return 'neg';
  if (priority.band === 'high') return 'warn';
  if (priority.band === 'medium') return 'pri';
  return 'mut';
}

// When it is wanted, in days rather than a date, because "in 3 days" is the thing being
// decided on and a date has to be worked out against today before it means that.
function wantedText(d) {
  const days = d.priority?.daysUntilNeeded;
  if (days === null || days === undefined) return d.deliveryDate || 'no date';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return 'today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

// The number the whole ordering turns on, written so it can be read at a glance.
function coverText(d) {
  const p = d.priority;
  if (!p || p.shortfallDays === null) return <span className="mut">not known</span>;
  const short = p.shortfallDays < 0;
  return (
    <>
      <Chip tone={short ? 'neg' : 'pos'}>
        {short ? `${Math.abs(p.shortfallDays)} days short` : `${p.shortfallDays} days spare`}
      </Chip>
      <div className="sub">
        {p.daysOfCover} days cover, {p.leadTimeDays} day lead time
      </div>
    </>
  );
}

// Where a requisition stands, in one chip, naming whoever is holding it.
//
// "Pending" on its own is the least useful thing a status column can say: it covers a
// document nobody has touched and one that is sitting on a director's desk, which are
// not the same problem. The state comes from the server with the document, so this only
// has to draw it.
export function RequisitionStatus({ document }) {
  const state = document.approvalState;
  if (!state) return <Chip tone="mut">Unknown</Chip>;

  if (state.state === 'approved') {
    return <Chip tone="pos" icon="check">Approved</Chip>;
  }
  if (state.state === 'rejected') {
    return <Chip tone="neg">Rejected</Chip>;
  }
  // Either open state can be sitting on your desk or on somebody else’s, so the chip says
  // how far it has got and the line under it says who has it. Two facts, not one.
  const withWhom = state.withYou ? 'with you' : `with ${state.holder || 'the next approver'}`;

  if (state.state === 'partial') {
    return (
      <>
        <Chip tone="pri" icon="clock">Partially approved</Chip>
        <div className="sub">{withWhom}</div>
      </>
    );
  }
  return (
    <>
      <Chip tone="warn" icon="clock">Pending</Chip>
      <div className="sub">{withWhom}</div>
    </>
  );
}

// Who the document is sitting with, in the words the row needs. A pending document that
// this manager has already signed is with the next approver, not with them.
function holder(d) {
  if (d.status === 'approved') return 'nobody, released';
  if (d.status === 'rejected') return 'nobody, rejected';
  if (d.decidedAt && d.next) return d.next.name;
  return 'you';
}

// Where a list stands, counted by status.
//
// The list below answers "what should I do next"; this answers "where does everything
// stand", which is asked before starting rather than during. Reading it off the list means
// reading every row.
//
// One component for both kinds, because the four states are the same four and a second
// copy would drift from this one the first time a word changed. What differs is what the
// lines underneath are worth saying: a requisition is chased because a plant runs dry, an
// order because a date has gone by. Those are the only two things passed in.
function StatusCounts({ documents, kind }) {
  const isOrder = kind === 'PO';
  const noun = isOrder ? 'order' : 'requisition';
  const inState = (state) => documents.filter((d) => d.approvalState?.state === state);

  const parts = [
    { key: 'waiting', label: 'Pending', icon: 'clock', tone: 'warn', sub: 'nobody has signed it yet', list: inState('waiting') },
    { key: 'partial', label: 'Partially approved', icon: 'people', tone: 'pri', sub: 'signed once, still short of a release', list: inState('partial') },
    {
      key: 'approved',
      label: 'Approved',
      icon: 'check',
      tone: 'pos',
      sub: isOrder ? 'released to the vendor' : 'released to purchasing',
      list: inState('approved')
    },
    { key: 'rejected', label: 'Rejected', icon: 'back', tone: 'neg', sub: 'returned to whoever raised it', list: inState('rejected') }
  ];

  const pending = parts[0].list;
  const partial = parts[1].list;

  // Who is actually sitting on the part-approved ones that are not yours. This is what makes
  // the card worth more than the number on the tab: "2 partially approved" is a fact, "both
  // with Mr. Deshmukh" is something to act on.
  const holders = [
    ...new Set(partial.filter((d) => !d.approvalState?.withYou).map((d) => d.approvalState?.holder).filter(Boolean))
  ];

  // What is on your desk and cannot wait.
  //
  // For a requisition that is the critical band, the one whose rows say "Approve today".
  // For an order it is a date that has already gone by, which is a different kind of late
  // and belongs to the vendor rather than to the plant - so orders count those separately
  // and say so in their own words.
  const yours = documents.filter((d) => d.status === 'pending' && d.approvalState?.withYou);
  const urgent = isOrder
    ? yours.filter((d) => d.priority?.overdue)
    : yours.filter((d) => d.priority?.band === 'critical');

  // Released orders the vendor is late on. Nothing to approve here - somebody has to be rung.
  const lateOnVendor = isOrder ? documents.filter((d) => d.priority?.lateOnVendor) : [];

  return (
    <Card
      span="c12"
      icon={isOrder ? 'doc' : 'box'}
      tone="pri"
      title={isOrder ? 'Where the orders stand' : 'Where the requisitions stand'}
      subtitle="by approval status"
      action={
        <div className="statmoney">
          <div className="l">Value not yet released</div>
          <div className="v n">{inr(sumTotals([...pending, ...partial]))}</div>
        </div>
      }
    >
      <StatBand parts={parts} />

      <div className="statgrid">
        {parts.map((p) => (
          <StatBox
            key={p.key}
            icon={p.icon}
            label={p.label}
            value={p.list.length}
            sub={p.sub}
            tone={p.list.length ? p.tone : 'mut'}
          />
        ))}
      </div>

      {urgent.length > 0 && (
        <div className="flagline">
          <Icon name="alert" size={14} />
          {isOrder ? (
            <>
              {plural(urgent.length, 'order')} on your desk {urgent.length === 1 ? 'is' : 'are'} already
              past the delivery date, and the vendor has not been told to start.
            </>
          ) : (
            <>
              {urgent.length === 1 ? '1 requisition needs' : `${urgent.length} requisitions need`} approving
              today: the plant runs dry before a new load can land, even if you approve right now.
            </>
          )}
        </div>
      )}

      {lateOnVendor.length > 0 && (
        <div className="flagline">
          <Icon name="truck" size={14} />
          {plural(lateOnVendor.length, 'released order')} past the date with the vendor. Nothing to
          approve — they need chasing.
        </div>
      )}

      {holders.length > 0 && (
        <div className="flagline">
          <Icon name="clock" size={14} />
          Partly approved and now with {holders.join(', ')}. Open one to send a reminder.
        </div>
      )}

      {documents.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Nothing to count — no {noun}s match the filters.
        </p>
      )}
    </Card>
  );
}

// `kind` is 'PO' or 'PR'. Everything else on the screen follows from it.
// What to do with an order next, as a cell.
//
// Two of these four do something the row cannot: they write a mail. The other two open
// the order, which clicking the row also does - they are here because a column of
// next steps that goes blank on half its rows stops being read at all, and because the
// row being clickable is not something anybody discovers.
function OrderAction({ document, onOpenDocument, onChase }) {
  const next = orderAction(document);

  if (next.state === 'to-approve') {
    return (
      <>
        <button
          type="button"
          className="btn sm emph"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDocument(document.id);
          }}
        >
          <Icon name="check" size={12} />
          Approve PO
        </button>
        {/* Says where the click goes. Nothing is approved from a list without the order
            in front of you, and a button that hid that would be worse than no button.

            Where the date has already gone, that is the more useful thing to say. The
            delay is ours, not the vendor’s - they have not been told yet - so the answer
            is to approve it, not to chase anybody. */}
        <div className="sub">
          {document.priority?.lateOnUs
            ? `date passed ${plural(Math.abs(document.priority.daysUntilDue), 'day')} ago`
            : 'opens the order'}
        </div>
      </>
    );
  }

  if (next.state === 'with-someone') {
    return (
      <>
        <button
          type="button"
          className="btn sm"
          onClick={(event) => {
            event.stopPropagation();
            onChase(document, 'approver');
          }}
        >
          <Icon name="mail" size={12} />
          Remind {firstName(next.holder) || 'them'}
        </button>
        <div className="sub">signed at your step</div>
      </>
    );
  }

  if (next.state === 'overdue') {
    return (
      <>
        <button
          type="button"
          className="btn sm rej"
          onClick={(event) => {
            event.stopPropagation();
            onChase(document, 'vendor');
          }}
        >
          <Icon name="mail" size={12} />
          Chase vendor
        </button>
        <div className="sub">{plural(next.daysLate, 'day')} late</div>
      </>
    );
  }

  if (next.state === 'to-send') {
    return (
      <>
        <button
          type="button"
          className={`btn sm ${next.daysLate ? 'rej' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenDocument(document.id);
          }}
        >
          <Icon name="mail" size={12} />
          Send to vendor
        </button>
        {/* The order is approved and the vendor still does not know. Nothing can be late
            on them until it has gone out, so this is the step in the way. */}
        <div className="sub">
          {next.daysLate ? `${plural(next.daysLate, 'day')} past the date already` : 'not told yet'}
        </div>
      </>
    );
  }

  if (next.state === 'closed') {
    return <span className="sub">back with the buyer</span>;
  }

  return (
    <>
      <button
        type="button"
        className="btn sm"
        onClick={(event) => {
          event.stopPropagation();
          onOpenDocument(document.id);
        }}
      >
        <Icon name="doc" size={12} />
        View PO
      </button>
      <div className="sub">released</div>
    </>
  );
}

export default function Approvals({ data, plant, kind = 'PO', onOpenDocument, onRaisePO, onChase }) {
  const isOrder = kind === 'PO';

  // Three narrowings, kept apart: a window of time, a place in the approval chain, and
  // whatever is being looked for by hand.
  const [period, setPeriod] = useState('all');
  const [state, setState] = useState('all');
  const [query, setQuery] = useState('');

  const all = documentsOfKind(data.documents, plant, kind);

  // What a requisition turned into, and what an order came from.
  //
  // This is why the search box is worth more than a filter over the rows on screen. Somebody
  // holding a purchase order number wants the requisition behind it, and the two numbers look
  // nothing like each other - 4500178512 against 1000442403 - so without this they would have
  // to know the pairing already, which is exactly what they came here to look up.
  const partner = new Map();
  for (const d of data.documents) {
    if (d.kind === 'PO' && d.sourceDocument) {
      partner.set(d.sourceDocument, d.id);
      partner.set(d.id, d.sourceDocument);
    }
  }

  // What was typed, and the same thing with the document word taken off the front.
  //
  // Numbers are copied out of mail and they come with their label attached: nobody pastes
  // 4500178512, they paste "PO 4500178512". Both forms are tried rather than the stripped
  // one only, so a search for a vendor whose name happens to start with one of these words
  // still finds them.
  const needles = [...new Set([
    loosely(query),
    loosely(String(query).replace(/^s*(purchases+)?(requisitions?|orders?|po|pr|req)[s:#-]*/i, ''))
  ])].filter(Boolean);

  const matches = (d) =>
    needles.length === 0 ||
    [d.id, d.supplierName, d.material, d.plant, d.materialCode, partner.get(d.id)].some((field) => {
      const text = loosely(field);
      return needles.some((needle) => text.includes(needle));
    });

  const needle = needles[0] || '';

  const documents = all.filter(
    (d) => withinPeriod(d, period) && matchesApprovalState(d, state) && matches(d)
  );
  const hidden = all.length - documents.length;
  const noun = isOrder ? 'order' : 'requisition';

  return (
    <>
      <Banner icon="eye">
        {isOrder ? (
          <>
            Open any order to see the full header: value, vendor and GST, payment terms, freight
            and loading, transport, discounts and rebate, incoterms, who approved it before you,
            and who it goes to after you.
          </>
        ) : (
          <>
            <b>Critical first, then High, Medium and Low</b> &mdash; and within each, whichever
            is wanted soonest, with the larger shortage breaking a tie. What decides the band is
            days of cover against the lead time: where cover is shorter, the plant runs dry
            before a new load can land even if you approve right now, so a comfortable date and
            an empty store still read as urgent.
          </>
        )}
      </Banner>

      <StatusCounts documents={documents} kind={kind} />

      <Card
        span="c12"
        flush
        icon={isOrder ? 'doc' : 'box'}
        tone={isOrder ? 'warn' : 'neg'}
        title={isOrder ? 'Purchase orders' : 'Purchase requisitions'}
        subtitle={`${plural(documents.length, noun)}${
          hidden ? `, ${hidden} hidden by the filters` : isOrder ? '' : ', most urgent first'
        }`}
        beside={
          <input
            className="noteinput find"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isOrder ? 'Search order or requisition…' : 'Search requisition or order…'}
            aria-label={`Search ${noun}s`}
          />
        }
        action={
          <div className="filters">
              <select
                className="sel"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-label={`Show ${noun}s raised within`}
              >
                {PERIODS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
              <select
                className="sel"
                value={state}
                onChange={(e) => setState(e.target.value)}
                aria-label={`Show ${noun}s at status`}
              >
                {APPROVAL_STATES.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
            </select>
          </div>
        }
      >
        {documents.length === 0 ? (
          <p className="muted rowpad">
            {all.length === 0
              ? `No ${noun}s here for ${plant === 'all' ? 'any plant' : plant}.`
              : needle
                ? `Nothing matches "${query}". Numbers, vendors, materials and plants are all searched — and so is the ${isOrder ? 'requisition each order came from' : 'order raised from each requisition'}.`
                : `No ${noun}s match these filters. Widen the period or the status to see the rest.`}
          </p>
        ) : (
          <table>
            <thead>
              {isOrder ? (
                <tr>
                  <th>Priority</th>
                  <th>Order</th>
                  <th>From requisition</th>
                  <th>Vendor</th>
                  <th>Plant</th>
                  <th className="rt">Quantity</th>
                  <th className="rt">Order value</th>
                  <th>Delivery date</th>
                  <th>Approval stage</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              ) : (
                <tr>
                  <th>Priority</th>
                  <th>Requisition</th>
                  <th>Plant</th>
                  <th>Wanted</th>
                  <th>Cover against lead time</th>
                  <th className="rt">Stock and shortage</th>
                  <th className="rt">Value</th>
                  <th>Raised by</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              )}
            </thead>
            <tbody>
              {!isOrder
                ? byPriority(documents).map((d, index) => (
                    <tr key={d.id} className="clickrow" onClick={() => onOpenDocument(d.id)}>
                      <td>
                        <Chip
                          tone={bandToneFor(d.priority)}
                          icon={d.priority?.band === 'critical' ? 'alert' : undefined}
                        >
                          {d.priority?.label || 'Low'}
                        </Chip>
                        {/* The queue position, and only where there is a queue. A rank on a
                            released requisition would read as a place in a line it left. */}
                        {d.approvalState?.withYou && d.status === 'pending' && (
                          <div className="sub n">#{index + 1} to approve</div>
                        )}
                      </td>
                      <td>
                        <b>{d.id}</b>
                        <div className="sub">
                          {d.material}
                          {d.priority?.lineCount > 1 &&
                            `, and ${plural(d.priority.lineCount - 1, 'more line')}`}
                        </div>
                        {/* Which line the figures across this row belong to. A bundle is
                            ranked on its worst line, so on a two-line requisition the
                            cover and shortage columns can be describing a material the
                            row has not named - and a column that quietly changes what it
                            is measuring is worse than one that is missing. */}
                        {d.priority?.drivenBy && d.priority.drivenBy !== d.material && (
                          <div className="sub">
                            worst line: <b>{d.priority.drivenBy}</b>
                          </div>
                        )}
                        <div className="sub">
                          <b>{d.priority?.advice}</b>
                        </div>
                      </td>
                      <td>
                        {d.plant}
                        {d.priority?.kiln && <div className="sub">kiln runs on it</div>}
                      </td>
                      <td className="sub">{wantedText(d)}</td>
                      <td>{coverText(d)}</td>
                      {/* Asked for, in stock, and the difference - the three figures the
                          business states the shortage in, kept in one column so the row
                          stays readable on a laptop. */}
                      <td className="rt n">
                        {d.priority?.shortageAgainstStock > 0 ? (
                          <Chip tone="neg">
                            short {num(d.priority.shortageAgainstStock)} {d.priority.unit}
                          </Chip>
                        ) : (
                          <Chip tone="pos">covered</Chip>
                        )}
                        <div className="sub n">
                          {num(d.priority?.askedFor ?? d.quantity)} asked,{' '}
                          {d.priority?.stockAvailable === null || d.priority?.stockAvailable === undefined
                            ? 'stock not known'
                            : `${num(d.priority.stockAvailable)} available`}
                        </div>
                        {/* A requisition the stock covers can still sit on a plant that is
                            about to run dry, and then the row reads "Critical" beside
                            "covered" and looks like it is arguing with itself. It is not:
                            one figure is this requisition, the other is the plant. Saying
                            the second out loud is cheaper than letting somebody decide the
                            screen cannot be trusted. */}
                        {d.priority?.shortageAgainstStock === 0 && d.priority?.shortBy > 0 && (
                          <div className="sub n">
                            plant short {num(d.priority.shortBy)} {d.priority.unit}
                          </div>
                        )}
                      </td>
                      <td className="rt n">{inr(d.total)}</td>
                      <td className="sub">{d.createdBy ? d.createdBy.name : 'not recorded'}</td>
                      <td><RequisitionStatus document={d} /></td>
                      <td>
                        <RequisitionAction
                          documents={data.documents}
                          document={d}
                          onOpenDocument={onOpenDocument}
                          onRaisePO={onRaisePO}
                        />
                      </td>
                    </tr>
                  ))
                : byOrderPriority(documents).map((d) => (
                  <tr key={d.id} className="clickrow" onClick={() => onOpenDocument(d.id)}>
                    <td>
                      <Chip
                        tone={bandToneFor(d.priority)}
                        icon={d.priority?.band === 'critical' ? 'alert' : undefined}
                      >
                        {d.priority?.label || 'Low'}
                      </Chip>
                      <div className="sub">{d.priority?.advice}</div>
                    </td>
                    <td>
                      <b>{d.kind} {d.id}</b>
                      <div className="sub">{d.material}, {d.materialCode}</div>
                      {d.items?.length > 1 && (
                        <div className="sub">and {plural(d.items.length - 1, 'more line')}</div>
                      )}
                    </td>
                    {/* The requisition this order answers. Blank is a real answer: not every
                        order comes from one - a contract release or a service order does not. */}
                    <td className="sub n">
                      {d.sourceDocument ? (
                        <button
                          type="button"
                          className="btn sm q"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenDocument(d.sourceDocument);
                          }}
                        >
                          {d.sourceDocument}
                        </button>
                      ) : (
                        <span className="mut">raised directly</span>
                      )}
                    </td>
                    <td>
                      {d.supplierName}
                      {d.supplierScore?.scored && (
                        <div className="sub">
                          <Score value={d.supplierScore.total} tone={bandTone(d.supplierScore.band)} size="13px" />
                        </div>
                      )}
                    </td>
                    <td>{d.plant}</td>
                    <td className="rt n">{num(d.quantity)} {d.unit}</td>
                    <td className="rt n"><b>{inr(d.total)}</b></td>
                    <td>
                      {d.deliveryDate}
                      {d.priority?.overdue && (
                        <div className="sub">
                          <Chip tone="neg">{Math.abs(d.priority.daysUntilDue)} days late</Chip>
                        </div>
                      )}
                    </td>
                    {/* Which step it is at, and who is standing on it. Two halves of one
                        answer: a step with no name is a queue nobody owns. */}
                    <td className="sub">
                      {d.step}
                      <div className="sub">with {holder(d)}</div>
                    </td>
                    <td><StatusChip status={d.status} document={d} /></td>
                    <td>
                      <OrderAction
                        document={d}
                        onOpenDocument={onOpenDocument}
                        onChase={onChase}
                      />
                    </td>
                  </tr>
                    ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

// Where a document has got to, as one chip.
//
// It reads the approval state rather than working it out again from the status field. It
// used to do the latter, and got it wrong in exactly the way the requisition chip beside
// it got right: an order signed at step one and passed to you showed "Pending", while the
// page below it listed the person who signed under "Who has approved so far". Two answers
// to one question, on one screen.
export function StatusChip({ status, document }) {
  const state = document?.approvalState;

  if (status === 'approved') return <Chip tone="pos" icon="check">Approved</Chip>;
  if (status === 'rejected') return <Chip tone="neg">Rejected</Chip>;

  if (state?.state === 'partial') {
    return <Chip tone="pri" icon="clock">Partially approved</Chip>;
  }

  return <Chip tone="warn" icon="clock">Pending</Chip>;
}

