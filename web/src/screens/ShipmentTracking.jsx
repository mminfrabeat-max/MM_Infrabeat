// Where released orders actually are.
//
// The other side of the approval list, and the last part of the P2P cycle the dashboard
// could not show. An order that has finished its approvals disappears from "Waiting for
// approval" - correctly, nothing is waiting on anybody - and until now went nowhere. But
// that is the moment it starts to matter most: it has gone to the vendor, and what happens
// next is somebody else's to do and yours to watch.
//
// The list is deliberately the same shape as the approval list, because it is the same
// documents at a later point in their life, and a person should not have to learn a second
// table to read them.

import { useState } from 'react';
import { inr } from '../format.js';
import { byPlant } from '../selectors.js';
import { Card, Banner, Chip, Icon, SimulatedNote } from '../components/ui.jsx';

// Mirrors server/src/domain/shipment.js. The server decides for real; this is so the screen
// can draw the line and the button before asking.
export const STAGES = [
  { key: 'released', label: 'Released', action: null },
  { key: 'sent', label: 'Sent to vendor', action: 'Mark as sent to vendor' },
  { key: 'dispatched', label: 'Dispatched', action: 'Mark as dispatched' },
  { key: 'transit', label: 'In transit', action: 'Mark as in transit' },
  { key: 'delivered', label: 'Delivered', action: 'Mark as delivered' },
  { key: 'received', label: 'Goods receipt', action: 'Book the goods receipt' }
];

export function isTrackable(document) {
  return document.kind === 'PO' && document.status === 'approved';
}

export function trackedOrders(documents, plant) {
  return byPlant(documents, plant).filter(isTrackable);
}

function stageIndexOf(document) {
  const found = STAGES.findIndex((s) => s.key === (document.shipmentStage || 'released'));
  return found === -1 ? 0 : found;
}

function nextStageOf(document) {
  const index = stageIndexOf(document);
  return index >= STAGES.length - 1 ? null : STAGES[index + 1];
}

// How far along, as a tone: nothing moving yet, on its way, arrived.
function toneFor(document) {
  const index = stageIndexOf(document);
  if (index === STAGES.length - 1) return 'pos';
  if (index === 0) return 'warn';
  return 'pri';
}

export default function ShipmentTracking({ data, plant, canDecide, onAdvance, busyId, onOpenDocument }) {
  const orders = trackedOrders(data.documents, plant);
  const [notes, setNotes] = useState({});

  const waiting = orders.filter((d) => stageIndexOf(d) === 0).length;
  const arrived = orders.filter((d) => stageIndexOf(d) === STAGES.length - 1).length;

  if (orders.length === 0) {
    return (
      <>
        <Banner kind="info" icon="truck">
          <b>Nothing is on its way yet.</b> An order appears here once it has finished every
          approval and been released, because that is when it reaches the vendor and they can
          start getting the material to you. Approve an order through to the end and it will
          show up.
        </Banner>
        <SimulatedNote>
          Stages are recorded here by hand. There is no connection to a vendor system or a
          carrier, so nothing can move on its own - and a line that advanced by itself would
          look like live tracking while being invented.
        </SimulatedNote>
      </>
    );
  }

  return (
    <>
      <Banner kind={waiting > 0 ? 'err' : 'ok'} icon="truck">
        <b>{orders.length === 1 ? '1 released order' : `${orders.length} released orders`}</b>
        {waiting > 0 ? (
          <>
            {' '}— <b>{waiting}</b> {waiting === 1 ? 'has' : 'have'} not been sent to the vendor yet.
            Nothing moves until they are told.
          </>
        ) : (
          <> — all with the vendor. {arrived > 0 ? `${arrived} already booked into stock.` : ''}</>
        )}
      </Banner>

      <Card span="c12" flush icon="truck" tone="pri" title="Released orders" subtitle="what is on its way">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Vendor</th>
              <th>Plant</th>
              <th className="rt">Total value</th>
              <th>Transport</th>
              <th>Delivery</th>
              <th>Stage</th>
              <th>Recorded</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((d) => (
              <tr key={d.id} className="clickrow" onClick={() => onOpenDocument && onOpenDocument(d.id)}>
                <td>
                  <b>{d.kind} {d.id}</b>
                  <div className="sub">{d.material}, {d.materialCode}</div>
                </td>
                <td>
                  {d.supplierName}
                  {d.vessel ? <div className="sub">{d.vessel.from} → {d.vessel.to}</div> : null}
                </td>
                <td>{d.plant}</td>
                <td className="rt n"><b>{inr(d.total)}</b></td>
                <td className="sub">{d.transport}</td>
                <td className="sub">{d.deliveryDate || 'not set'}</td>
                <td><Chip tone={toneFor(d)}>{STAGES[stageIndexOf(d)].label}</Chip></td>
                <td className="sub">{d.shipmentStageAt || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {orders.map((d) => {
        const index = stageIndexOf(d);
        const next = nextStageOf(d);
        const busy = busyId === d.id;

        return (
          <Card
            key={d.id}
            span="c12"
            icon="truck"
            tone={toneFor(d)}
            title={`${d.kind} ${d.id} — ${d.material}`}
            subtitle={`${d.supplierName} to ${d.plant}, ${d.transport || 'transport not set'}`}
          >
            <div className="journey">
              {STAGES.map((stage, i) => (
                <div key={stage.key} className={`stepline ${i < index ? 'done' : i === index ? 'done' : 'wait'}`}>
                  <span className={`sd bg-${i <= index ? (i === STAGES.length - 1 ? 'pos' : 'pri') : 'mut'}`}>
                    <Icon name={i < index ? 'check' : i === index ? 'truck' : 'clock'} size={13} />
                  </span>
                  <div>
                    <div className="s1">
                      {stage.label}
                      {i === index ? <span className="mut"> — where it is now</span> : null}
                    </div>
                    {i === index && d.shipmentStageAt ? (
                      <div className="s2">recorded {d.shipmentStageAt}</div>
                    ) : null}
                    {i === index && d.shipmentNote ? (
                      <div className="s2" style={{ fontStyle: 'italic' }}>&ldquo;{d.shipmentNote}&rdquo;</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {d.vessel ? (
              <div className="footnote">
                <b>{d.vessel.name}</b> (IMO {d.vessel.imo}), bill of lading {d.vessel.billOfLading}.
                {' '}Last seen {d.vessel.position}, ETA {d.vessel.eta}. {d.vessel.afterPort}.
                <div className="mut">Position from {d.vessel.source}, updated {d.vessel.updated}.</div>
              </div>
            ) : null}

            {next && canDecide ? (
              <div className="footerbar">
                <span className="muted" style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="shield" size={13} /> Recording what has already happened
                </span>
                <input
                  className="noteinput"
                  placeholder="Note — a docket number, a delay, who confirmed it"
                  value={notes[d.id] || ''}
                  onChange={(e) => setNotes({ ...notes, [d.id]: e.target.value })}
                  disabled={busy}
                />
                <button
                  className="btn emph"
                  type="button"
                  disabled={busy}
                  onClick={() => onAdvance(d, next.key, notes[d.id] || '')}
                >
                  <Icon name="check" size={13} />
                  {busy ? 'Saving…' : next.action}
                </button>
              </div>
            ) : !next ? (
              <div className="flagline">
                <Icon name="check" size={14} />
                Booked into stock{d.shipmentStageAt ? ` on ${d.shipmentStageAt}` : ''}. This order is complete.
              </div>
            ) : null}
          </Card>
        );
      })}

      <SimulatedNote>
        Every stage here is recorded by the person watching it happen, not reported by the
        vendor or a carrier — there is no connection to either. Stages only move forwards,
        one step at a time, because they are a record of what happened rather than a guess
        at where the goods are.
      </SimulatedNote>
    </>
  );
}
