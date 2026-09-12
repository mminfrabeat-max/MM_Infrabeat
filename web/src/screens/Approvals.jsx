// The approval list. One row per document, with enough header detail to decide whether to
// open it at all.
//
// One screen, two tabs. Orders and requisitions are the same shape and are read the same
// way, but they are different decisions: a requisition asks whether something is needed
// at all, an order commits money to a named vendor. Splitting the list is what lets
// somebody clear all the small requisitions without the crore-value orders scrolling past
// in between - and the counts on the tabs then mean something on their own.

import { inr, num } from '../format.js';
import { documentsOfKind, byPriority, sumTotals, requisitionAction } from '../selectors.js';
import { Card, Banner, Chip, Score, Icon, Count } from '../components/ui.jsx';
import { bandTone } from '../format.js';

// How urgent a requisition is, as a colour. The bands come from the server, which works
// them out from the stock position - see server/src/domain/requisition-priority.js.
function bandToneFor(priority) {
  if (!priority) return 'mut';
  if (priority.band === 'critical') return 'neg';
  if (priority.band === 'urgent') return 'warn';
  if (priority.band === 'soon') return 'pri';
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
    return <Chip tone="neg">Sent back</Chip>;
  }
  if (state.state === 'partial') {
    return (
      <>
        <Chip tone="pri" icon="clock">Partially approved</Chip>
        <div className="sub">with {state.holder}</div>
      </>
    );
  }
  return (
    <>
      <Chip tone="warn" icon="clock">Pending</Chip>
      <div className="sub">with you</div>
    </>
  );
}

// Who the document is sitting with, in the words the row needs. A pending document that
// this manager has already signed is with the next approver, not with them.
function holder(d) {
  if (d.status === 'approved') return 'nobody, released';
  if (d.status === 'rejected') return 'nobody, sent back';
  if (d.decidedAt && d.next) return d.next.name;
  return 'you';
}

// One status, as a number big enough to read from across a desk.
//
// Borrowed from the overview Tile on purpose - tinted icon square, big figure, label
// beneath - because that is what a number looks like everywhere else here, and a summary
// that invents its own furniture reads as a different product bolted on.
function StatBox({ icon, label, value, sub, tone }) {
  return (
    <div className={`statbox ${tone}`}>
      <div className="statrow">
        <span className={`ico ${tone}`}>
          <Icon name={icon} />
        </span>
        <div className={`statnum n ${tone}`}>{value}</div>
      </div>
      <div className="statlab">{label}</div>
      <div className="statsub">{sub}</div>
    </div>
  );
}

// The same four counts as one bar.
//
// Four numbers still have to be added up before they mean anything; the bar has done that
// already, and the answer it gives - how much of this is still mine - is the one the card
// exists for. Empty states are left out rather than drawn at zero width, so the segments
// that are there keep their proportions honest.
function StatBand({ parts }) {
  const total = parts.reduce((sum, p) => sum + p.list.length, 0);
  if (!total) return null;

  return (
    <div
      className="statband"
      role="img"
      aria-label={parts.map((p) => `${p.list.length} ${p.label.toLowerCase()}`).join(', ')}
    >
      {parts
        .filter((p) => p.list.length > 0)
        .map((p) => (
          <span
            key={p.key}
            className={p.tone}
            style={{ width: `${(p.list.length / total) * 100}%` }}
            title={`${p.list.length} ${p.label.toLowerCase()}`}
          />
        ))}
    </div>
  );
}

// What to do with a requisition next, as a cell.
//
// The button has to say what pressing it does, and the two here do very different things.
// "View PO" moves you to a document. "Raise PO" asks a person to make one, and asking a
// person is not the same as it being done - so the row still reads "no order yet"
// afterwards, because that is still true until the buyer acts.
function RequisitionAction({ documents, document, onOpenDocument, onRaisePO }) {
  const next = requisitionAction(documents, document);

  if (next.state === 'ordered') {
    return (
      <>
        <button
          type="button"
          className="btn sm"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDocument(next.order.id);
          }}
        >
          <Icon name="doc" size={12} />
          View PO
        </button>
        <div className="sub n">{next.order.id}</div>
      </>
    );
  }

  if (next.state === 'to-order') {
    return (
      <>
        <button
          type="button"
          className="btn sm emph"
          onClick={(event) => {
            event.stopPropagation();
            onRaisePO(document);
          }}
        >
          <Icon name="mail" size={12} />
          Raise PO
        </button>
        <div className="sub">no order yet</div>
      </>
    );
  }

  if (next.state === 'closed') {
    return <span className="sub">back with {document.createdBy ? document.createdBy.name : 'the raiser'}</span>;
  }

  // Still being approved. The row itself opens it, so a button here would be a second way
  // to do the same thing, and two ways to do one thing is how people end up doing neither.
  return <span className="sub">waiting for approval</span>;
}

// The requisitions split by status, counted.
//
// The list below answers "what should I do next"; this answers "where does everything
// stand", which is asked before starting rather than during. Reading it off the list means
// reading every row - nine rows do not tell you that five are yours and two are stuck
// elsewhere until you have been through all nine.
//
// The four words are exactly the four the Status column uses. A summary with its own
// vocabulary makes the reader map one onto the other, which is the work it was meant to
// save.
function RequisitionCounts({ documents }) {
  const inState = (state) => documents.filter((d) => d.approvalState?.state === state);

  const parts = [
    { key: 'waiting', label: 'Pending', icon: 'clock', tone: 'warn', sub: 'waiting on you', list: inState('waiting') },
    { key: 'partial', label: 'Partially approved', icon: 'people', tone: 'pri', sub: 'signed once, now with the next approver', list: inState('partial') },
    { key: 'approved', label: 'Approved', icon: 'check', tone: 'pos', sub: 'released', list: inState('approved') },
    { key: 'rejected', label: 'Sent back', icon: 'back', tone: 'neg', sub: 'returned to whoever raised it', list: inState('rejected') }
  ];

  const pending = parts[0].list;
  const partial = parts[1].list;

  // Who is actually sitting on the part-approved ones. This is what makes the card worth
  // more than the number on the tab: "2 partially approved" is a fact, "both with Mr.
  // Deshmukh" is something to act on.
  const holders = [...new Set(partial.map((d) => d.approvalState?.holder).filter(Boolean))];

  // Only the critical band, because that is the one whose rows say "Approve today". Adding
  // the urgent ones would make the card contradict the list it sits above.
  const today = pending.filter((d) => d.priority?.band === 'critical');

  return (
    <Card
      span="c12"
      icon="box"
      tone="pri"
      title="Where the requisitions stand"
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

      {today.length > 0 && (
        <div className="flagline">
          <Icon name="alert" size={14} />
          {today.length === 1 ? '1 requisition needs' : `${today.length} requisitions need`} approving
          today: the plant runs dry before a new load can land, even if you approve right now.
        </div>
      )}
      {holders.length > 0 && (
        <div className="flagline">
          <Icon name="clock" size={14} />
          Partly approved and now with {holders.join(', ')}. Open one to send a reminder.
        </div>
      )}
    </Card>
  );
}

// `kind` is 'PO' or 'PR'. Everything else on the screen follows from it.
export default function Approvals({ data, plant, kind = 'PO', onOpenDocument, onRaisePO }) {
  const documents = documentsOfKind(data.documents, plant, kind);
  const isOrder = kind === 'PO';
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
            <b>Ordered by what the plant is about to run out of</b>, not by how long each has
            been waiting. The figure that decides it is days of cover against the lead time:
            where cover is shorter, the plant runs dry before a new load can land even if you
            approve right now, and every day it waits adds to that gap.
          </>
        )}
      </Banner>

      {!isOrder && <RequisitionCounts documents={documents} />}

      <Card
        span="c12"
        flush
        icon={isOrder ? 'doc' : 'box'}
        tone={isOrder ? 'warn' : 'neg'}
        title={isOrder ? 'Purchase orders' : 'Purchase requisitions'}
        subtitle={isOrder ? 'longest wait first' : 'most urgent first'}
      >
        {documents.length === 0 ? (
          <p className="muted rowpad">No {noun}s here for {plant === 'all' ? 'any plant' : plant}.</p>
        ) : (
          <table>
            <thead>
              {isOrder ? (
                <tr>
                  <th>Order</th>
                  <th>Document type</th>
                  <th>Domestic or import</th>
                  <th>Vendor</th>
                  <th>Plant</th>
                  <th className="rt">Total value</th>
                  <th>Transport</th>
                  <th>Waiting</th>
                  <th>Raised by</th>
                  <th>With now</th>
                  <th>Status</th>
                </tr>
              ) : (
                <tr>
                  <th>#</th>
                  <th>Requisition</th>
                  <th>Plant</th>
                  <th>Wanted</th>
                  <th>Cover against lead time</th>
                  <th className="rt">Short by</th>
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
                        {/* Numbered only while it still needs your signature. A rank on a
                            released requisition would read as a queue position it is not in. */}
                        {d.approvalState?.state === 'waiting' ? (
                          <Chip tone={bandToneFor(d.priority)} icon={d.priority?.band === 'critical' ? 'alert' : undefined}>
                            {index + 1}
                          </Chip>
                        ) : d.approvalState?.state === 'partial' ? (
                          <Chip tone="mut" icon="clock">–</Chip>
                        ) : (
                          <Chip tone="mut" icon="check">–</Chip>
                        )}
                      </td>
                      <td>
                        <b>{d.id}</b>
                        <div className="sub">{d.material}</div>
                        <div className="sub">
                          <b>{d.priority?.label}</b>
                        </div>
                      </td>
                      <td>
                        {d.plant}
                        {d.priority?.kiln && <div className="sub">kiln runs on it</div>}
                      </td>
                      <td className="sub">{wantedText(d)}</td>
                      <td>{coverText(d)}</td>
                      <td className="rt n">
                        {d.priority?.shortBy > 0 ? (
                          <b>{num(d.priority.shortBy)} {d.priority.unit}</b>
                        ) : (
                          <span className="mut">covered</span>
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
                : documents
                    .slice()
                    .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
                    .map((d) => (
                  <tr key={d.id} className="clickrow" onClick={() => onOpenDocument(d.id)}>
                    <td>
                      <b>{d.kind} {d.id}</b>
                      <div className="sub">{d.material}, {d.materialCode}</div>
                    </td>
                    <td className="sub">{d.docType}</td>
                    <td>
                      <Chip tone={d.trade === 'Import' ? 'pri' : 'mut'}>{d.trade}</Chip>
                      <div className="sub">{d.incoterm.split(',')[0]}</div>
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
                    <td className="rt n"><b>{inr(d.total)}</b></td>
                    <td className="sub">{d.transport}</td>
                    <td>
                      <Chip tone={d.hoursWaiting > 48 ? 'neg' : d.hoursWaiting > 24 ? 'warn' : 'mut'}>
                        {d.hoursWaiting} h
                      </Chip>
                    </td>
                    <td className="sub">{d.createdBy ? d.createdBy.name : 'not recorded'}</td>
                    <td className="sub">{holder(d)}</td>
                    <td><StatusChip status={d.status} document={d} /></td>
                  </tr>
                    ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

// `document` is optional. Given it, the chip can tell apart the two states that both store
// themselves as "pending": waiting for you, and waiting for the person after you. They look
// identical in the database and mean opposite things to whoever is reading the screen.
export function StatusChip({ status, document }) {
  if (status === 'approved') return <Chip tone="pos" icon="check">Approved</Chip>;
  if (status === 'rejected') return <Chip tone="neg">Sent back</Chip>;
  if (document?.decidedAt) return <Chip tone="pri" icon="clock">Passed on</Chip>;
  return <Chip tone="warn" icon="clock">Waiting</Chip>;
}
