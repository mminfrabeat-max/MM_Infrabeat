// The approval list. One row per document, with enough header detail to decide whether to
// open it at all.
//
// One screen, two tabs. Orders and requisitions are the same shape and are read the same
// way, but they are different decisions: a requisition asks whether something is needed
// at all, an order commits money to a named vendor. Splitting the list is what lets
// somebody clear all the small requisitions without the crore-value orders scrolling past
// in between - and the counts on the tabs then mean something on their own.

import { inr } from '../format.js';
import { documentsOfKind } from '../selectors.js';
import { Card, Banner, Chip, Score } from '../components/ui.jsx';
import { bandTone } from '../format.js';

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
            A requisition asks for something; it does not commit to buying it. Open any of them
            to see what is wanted, who raised it, what it is expected to cost, and who has to
            approve it. The vendor shown is the one usually used, not one that has been agreed.
          </>
        )}
      </Banner>

      <Card
        span="c12"
        flush
        icon={isOrder ? 'doc' : 'file'}
        tone="warn"
        title={isOrder ? 'Purchase orders' : 'Purchase requisitions'}
        subtitle="longest wait first"
      >
        {documents.length === 0 ? (
          <p className="muted rowpad">No {noun}s here for {plant === 'all' ? 'any plant' : plant}.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{isOrder ? 'Order' : 'Requisition'}</th>
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
            </thead>
            <tbody>
              {documents
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
