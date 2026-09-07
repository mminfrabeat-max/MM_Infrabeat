// The approval list. One row per document, with enough header detail to decide whether to
// open it at all.

import { inr } from '../format.js';
import { byPlant } from '../selectors.js';
import { Card, Banner, Chip, Score } from '../components/ui.jsx';
import { bandTone } from '../format.js';

export default function Approvals({ data, plant, onOpenDocument }) {
  const documents = byPlant(data.documents, plant);

  return (
    <>
      <Banner icon="eye">
        Open any order to see the full header: value, vendor and GST, payment terms, freight
        and loading, transport, discounts and rebate, incoterms, and who approved it before you.
      </Banner>

      <Card span="c12" flush icon="doc" tone="warn" title="Purchasing documents" subtitle="longest wait first">
        {documents.length === 0 ? (
          <p className="muted rowpad">Nothing here for {plant}.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Document type</th>
                <th>Domestic or import</th>
                <th>Vendor</th>
                <th>Plant</th>
                <th className="rt">Total value</th>
                <th>Transport</th>
                <th>Waiting</th>
                <th>Approved before by</th>
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
                    <td className="sub">{d.prev ? d.prev.name : 'first step'}</td>
                    <td><StatusChip status={d.status} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export function StatusChip({ status }) {
  if (status === 'approved') return <Chip tone="pos" icon="check">Approved</Chip>;
  if (status === 'rejected') return <Chip tone="neg">Sent back</Chip>;
  return <Chip tone="warn" icon="clock">Waiting</Chip>;
}
