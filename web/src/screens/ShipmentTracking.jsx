// Where released orders actually are.
//
// The other side of the approval list, and the last part of the P2P cycle the dashboard
// could not show. An order that has finished its approvals disappears from the approval
// list - correctly, nothing is waiting on anybody - and until now went nowhere. But that is
// the moment it starts to matter most: it has gone to the vendor, and what happens next is
// somebody else's to do and yours to watch.
//
// One card per order, and the line across the top of each is the whole point. Six stages
// read left to right, coloured behind you and grey ahead, so the position is a shape rather
// than a word you have to look up.
//
// The vessel map lives here now rather than on the order page. An order being approved and
// an order being at sea are two different questions asked at two different times, and the
// page for deciding whether to approve something is not the page for watching it travel.

import { useEffect, useState } from 'react';
import { inr } from '../format.js';
import { byPlant } from '../selectors.js';
import { Card, Banner, Chip, Icon, SimulatedNote } from '../components/ui.jsx';
import { StageJourney, VesselMap, ConsignmentMap, modeIcon } from '../components/journey.jsx';

// Mirrors server/src/domain/shipment.js. The server decides for real; this is so the screen
// can draw the line and the button before asking.
//
// `sub` is what the stage means in the yard rather than what it is called, because the name
// alone ("Dispatched") is a word from a system and the sub-line is the thing that happened.
export const STAGES = [
  { key: 'released', label: 'Released', sub: 'order approved', icon: 'doc', action: null },
  { key: 'sent', label: 'Sent to vendor', sub: 'order mailed', icon: 'mail', action: 'Mark as sent to vendor' },
  { key: 'dispatched', label: 'Dispatched', sub: 'left the vendor', icon: 'box', action: 'Mark as dispatched' },
  { key: 'transit', label: 'In transit', sub: 'on the way', icon: 'truck', action: 'Mark as in transit' },
  { key: 'delivered', label: 'Delivered', sub: 'at the gate', icon: 'factory', action: 'Mark as delivered' },
  { key: 'received', label: 'Goods receipt', sub: 'booked into stock', icon: 'check', action: 'Book the goods receipt' }
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

// A count with a word under it. Deliberately not the Tile used on the overview: these are
// four facts about one list, not four places to go.
function Count({ label, value, sub, tone = 'mut' }) {
  return (
    <div className="tmet">
      <div className="l">{label}</div>
      <div className={`v ${tone}`}>{value}</div>
      <div className="l">{sub}</div>
    </div>
  );
}

// How long the carrier "takes" to get from the road to the gate, once a tracking number
// has been entered.
//
// Ten seconds, and it is a demonstration, not a delivery. There is no carrier feed behind
// any of this: the map moves because a timer said so. What that buys is being able to
// show somebody the whole cycle in a minute instead of a fortnight, and the screen says
// as much rather than letting it pass for live tracking.
//
// The important half is what it does NOT do: nothing is recorded when the timer fires.
// The order still sits at the stage it was at until a person presses the button. A
// simulation that wrote to the audit trail would be forging it.
const CARRIER_SECONDS = 10;

// The tracking flow for one order: enter the number, watch it, confirm it arrived.
function Consignment({ document, busy, onTrack, onArrive, onAdvance }) {
  const [trackingId, setTrackingId] = useState('');
  const [note, setNote] = useState('');
  const [atGate, setAtGate] = useState(false);

  const stage = document.shipmentStage || 'released';
  const tracking = document.trackingId;
  const enRoute = Boolean(tracking) && (stage === 'dispatched' || stage === 'transit');

  // The timer runs only while something is actually on the road. It is cleared on the way
  // out so a card that is closed or re-rendered does not leave one running behind it.
  useEffect(() => {
    if (!enRoute) {
      setAtGate(false);
      return undefined;
    }
    const timer = setTimeout(() => setAtGate(true), CARRIER_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [enRoute, document.id, tracking]);

  // Waiting for the vendor to send a number back.
  if (stage === 'sent' && !tracking) {
    return (
      <div className="cq">
        <div className="cqh">
          <Icon name="mail" size={13} /> Waiting for the vendor
        </div>
        <div className="cqt">
          The order has gone to {document.supplierName}. When they reply with a tracking
          number, put it in here and the consignment can be followed to the plant.
        </div>
        <div className="footerbar">
          <input
            className="noteinput"
            placeholder="Tracking number from the vendor, for example 12345678"
            value={trackingId}
            onChange={(e) => setTrackingId(e.target.value)}
            disabled={busy}
          />
          <button
            className="btn emph"
            type="button"
            disabled={busy || !trackingId.trim()}
            onClick={() => onTrack(document, trackingId.trim())}
          >
            <Icon name="truck" size={13} />
            {busy ? 'Saving…' : 'Track this consignment'}
          </button>
        </div>
      </div>
    );
  }

  // On the road, with a number to follow it by.
  if (enRoute) {
    return (
      <div className="vsplit">
        <div className="vsq">
          <ConsignmentMap
            from={document.supplierCity || document.supplierName}
            to={document.plant}
            arrived={atGate}
            trackingId={tracking}
          />
        </div>
        <div className="vfacts">
          <div className="kv"><span>Tracking number</span><b>{tracking}</b></div>
          <div className="kv"><span>Carrier</span><b>{document.supplierName}</b></div>
          <div className="kv"><span>Going to</span><b>{document.plant} plant</b></div>
          <div className="kv">
            <span>Reported</span>
            <b>{atGate ? 'At the gate' : 'On the way'}</b>
          </div>

          {atGate ? (
            <>
              <div className="flagline">
                <Icon name="check" size={14} />
                The carrier reports it at the {document.plant} gate. Confirm it is actually
                there and the delivery is recorded.
              </div>
              <div className="footerbar">
                <input
                  className="noteinput"
                  placeholder="Note, for example a gate pass number"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                />
                <button className="btn emph" type="button" disabled={busy} onClick={() => onArrive(document, note)}>
                  <Icon name="check" size={13} />
                  {busy ? 'Saving…' : 'Confirm delivered'}
                </button>
              </div>
            </>
          ) : (
            <div className="footnote mut">
              Following {tracking}. The map updates as the carrier reports in.
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export default function ShipmentTracking({ data, plant, canDecide, onAdvance, onTrack, onArrive, busyId, onOpenDocument }) {
  const orders = trackedOrders(data.documents, plant);
  const [notes, setNotes] = useState({});

  // Everything approved but not yet released is not on this screen at all, and saying how
  // many there are is the difference between "nothing is moving" and "nothing has been
  // released yet", which are different problems.
  const notReleased = byPlant(data.documents, plant).filter(
    (d) => d.kind === 'PO' && d.status === 'pending'
  ).length;

  const atStart = orders.filter((d) => stageIndexOf(d) === 0).length;
  const moving = orders.filter((d) => {
    const i = stageIndexOf(d);
    return i >= 1 && i <= 3;
  }).length;
  const atGate = orders.filter((d) => stageIndexOf(d) === 4).length;
  const booked = orders.filter((d) => stageIndexOf(d) === STAGES.length - 1).length;

  return (
    <>
      <Banner icon="truck">
        Every released order, from the vendor to goods receipt. Mark each step as it happens
        and the buyer sees the same position. Import orders also show where the vessel is.
      </Banner>

      <Card span="c12" icon="truck" tone="pri" title="Where everything is" subtitle="released orders only">
        <div className="tmets">
          <Count label="Released orders" value={orders.length} sub="approved and with the vendor" tone="pri" />
          <Count label="On the way" value={moving} sub="sent, dispatched or in transit" tone={moving ? 'warn' : 'mut'} />
          <Count label="At the gate" value={atGate} sub="delivered, receipt not booked" tone={atGate ? 'warn' : 'mut'} />
          <Count label="Booked into stock" value={booked} sub="complete" tone={booked ? 'pos' : 'mut'} />
          <Count label="Not released yet" value={notReleased} sub="orders still waiting for approval" tone="mut" />
        </div>
        {orders.length > 0 && atStart > 0 && (
          <div className="flagline">
            <Icon name="alert" size={14} />
            {atStart === 1 ? '1 order has' : `${atStart} orders have`} not been sent to the vendor yet. Nothing moves
            until they are told.
          </div>
        )}
      </Card>

      {orders.length === 0 ? (
        <Card span="c12" icon="truck" tone="mut" title="Nothing is on its way" subtitle="yet">
          <p className="muted">
            An order appears here once it has finished every approval and been released,
            because that is when it reaches the vendor and they can start getting the
            material to you. {notReleased > 0 ? `${notReleased} are still waiting for approval.` : ''}
          </p>
        </Card>
      ) : (
        orders.map((d) => {
          const index = stageIndexOf(d);
          const next = nextStageOf(d);
          const busy = busyId === d.id;
          const complete = index === STAGES.length - 1;
          // The consignment flow owns the card from "sent to vendor" until it is delivered:
          // that is the span a tracking number covers.
          const tracked = STAGES[index].key === 'sent' || ((d.trackingId) && (STAGES[index].key === 'dispatched' || STAGES[index].key === 'transit'));

          return (
            <Card
              key={d.id}
              span="c12"
              icon={modeIcon(d.transport)}
              tone={complete ? 'pos' : index === 0 ? 'warn' : 'pri'}
              title={`${d.kind} ${d.id}, ${d.supplierName}`}
              subtitle={`${d.material} · ${d.plant} plant · ${String(d.transport || 'transport not set').toLowerCase()} · ${d.deliveryDate || 'no delivery date'}`}
              action={
                onOpenDocument ? (
                  <button className="btn q" type="button" onClick={() => onOpenDocument(d.id)}>
                    Open order
                  </button>
                ) : null
              }
            >
              <StageJourney stages={STAGES} atIndex={index} />

              {(d.shipmentStageAt || d.shipmentNote) && (
                <div className="footnote">
                  <b>{STAGES[index].label}</b>
                  {d.shipmentStageAt ? ` recorded ${d.shipmentStageAt}` : ''}
                  {d.shipmentNote ? ` — “${d.shipmentNote}”` : ''}
                </div>
              )}

              {/* The map only for something actually at sea. A square rather than a banner:
                  it answers "which sea, off which coast", and that needs no more room. */}
              {d.vessel && (
                <div className="vsplit">
                  <div className="vsq">
                    <VesselMap vessel={d.vessel} />
                  </div>
                  <div className="vfacts">
                    <div className="kv"><span>Vessel</span><b>{d.vessel.name}</b></div>
                    <div className="kv"><span>IMO</span><b>{d.vessel.imo}</b></div>
                    <div className="kv"><span>Bill of lading</span><b>{d.vessel.billOfLading}</b></div>
                    <div className="kv"><span>Route</span><b>{d.vessel.from} → {d.vessel.to}</b></div>
                    <div className="kv"><span>ETA {d.vessel.to}</span><b>{d.vessel.eta}</b></div>
                    <div className="kv"><span>After it lands</span><b>{d.vessel.afterPort}</b></div>
                    <div className="feed">
                      <span className="outside">Outside SAP</span>
                      {d.vessel.source}, as of {d.vessel.updated}. SAP holds the order, not the ship.
                    </div>
                  </div>
                </div>
              )}

              {/* Once a tracking number is in play the consignment takes over the bottom of
                  the card: there is a map to look at and one thing to do, rather than a
                  step to tick. Everything before and after that is the ordinary bar. */}
              {canDecide && tracked ? (
                <Consignment
                  document={d}
                  busy={busy}
                  onTrack={onTrack}
                  onArrive={onArrive}
                  onAdvance={onAdvance}
                />
              ) : next && canDecide ? (
                <div className="footerbar">
                  <input
                    className="noteinput"
                    placeholder={`Note for “${next.label}”, for example a lorry or rake number`}
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
              ) : complete ? (
                <div className="flagline">
                  <Icon name="check" size={14} />
                  Booked into stock{d.shipmentStageAt ? ` on ${d.shipmentStageAt}` : ''}. This order is complete.
                </div>
              ) : null}

              <div className="footnote mut">
                {inr(d.total)} · raised by {d.createdBy ? d.createdBy.name : 'not recorded'} · released{' '}
                {d.decidedAt || 'recently'}
              </div>
            </Card>
          );
        })
      )}

      <SimulatedNote>
        Every stage here is recorded by the person watching it happen, not reported by the
        vendor or a carrier — there is no connection to either. Stages only move forwards,
        one step at a time, because they are a record of what happened rather than a guess at
        where the goods are. The vessel position is a real AIS feed and is the one thing on
        this screen that moves on its own.
      </SimulatedNote>
    </>
  );
}
