// The approval list. One row per document, with enough header detail to decide whether to
// open it at all.
//
// One screen, two tabs. Orders and requisitions are the same shape and are read the same
// way, but they are different decisions: a requisition asks whether something is needed
// at all, an order commits money to a named vendor. Splitting the list is what lets
// somebody clear all the small requisitions without the crore-value orders scrolling past
// in between - and the counts on the tabs then mean something on their own.

import { inr, num } from '../format.js';
import { documentsOfKind, byPriority } from '../selectors.js';
import { Card, Banner, Chip, Score } from '../components/ui.jsx';
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

// Who the document is sitting with, in the words the row needs. A pending document that
// this manager has already signed is with the next approver, not with them.
function holder(d) {
  if (d.status === 'approved') return 'nobody, released';
  if (d.status === 'rejected') return 'nobody, sent back';
  if (d.decidedAt && d.next) return d.next.name;
  return 'you';
}

// `kind` is 'PO' or 'PR'. Everything else on the screen follows from it.
export default function Approvals({ data, plant, kind = 'PO', onOpenDocument }) {
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
                  <th>With now</th>
                  <th>Status</th>
                </tr>
              )}
            </thead>
            <tbody>
              {!isOrder
                ? byPriority(documents).map((d, index) => (
                    <tr key={d.id} className="clickrow" onClick={() => onOpenDocument(d.id)}>
                      <td>
                        <Chip tone={bandToneFor(d.priority)} icon={d.priority?.band === 'critical' ? 'alert' : undefined}>
                          {index + 1}
                        </Chip>
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
                      <td className="sub">{holder(d)}</td>
                      <td><StatusChip status={d.status} document={d} /></td>
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
