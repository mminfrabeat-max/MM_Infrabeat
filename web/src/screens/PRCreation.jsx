// Raising a purchase requisition.
//
// The first step of the P2P cycle, and until now the one the dashboard could not do. The
// stock screen's "raise request" moved a number and wrote a log line; nothing was ever
// created. This makes a real requisition: a number in the same series SAP uses, an
// approval chain worked out from its value, and a place in the approval queue.
//
// The form deliberately shows what the document WILL be before it exists - its value, and
// who will have to sign it. A chain is a surprising thing to discover after a document has
// already been mailed to a director.

import { useMemo, useState } from 'react';
import { inr, num } from '../format.js';
import { byPlant } from '../selectors.js';
import { Card, Banner, Chip, SimulatedNote } from '../components/ui.jsx';

// The same bands as server/src/domain/creation.js. Shown here so the form can explain
// itself as the numbers are typed; the server decides for real, and its answer is what the
// document gets. If the two ever disagree, the server is right.
const PR_ALONE_LIMIT = 1000000;

function chainNote(basic) {
  if (!basic) return 'Enter a quantity to see who will need to approve it.';
  if (basic < PR_ALONE_LIMIT) return 'Under ten lakh, so you can release this requisition yourself.';
  return 'Ten lakh or more, so it goes to Mr. Anil Deshmukh, Head of Procurement, for release after you.';
}

// Everyone who raises documents in this system. Buyers never sign in - the dashboard
// belongs to one manager - so raising one on their behalf is how a requisition gets an
// owner who is told what happens to it.
const RAISERS = [
  { name: 'Hrutik Patil', title: 'Buyer, Procurement' },
  { name: 'P. Kamat', title: 'Buyer, Spares' },
  { name: 'D. Ghorpade', title: 'Planner, Raw materials' },
  { name: 'N. Shirke', title: 'Buyer, Packing' }
];

export default function PRCreation({ data, plant, canDecide, onCreate, busy }) {
  const materials = byPlant(data.materials, plant);

  const [code, setCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [rate, setRate] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [reason, setReason] = useState('');
  const [raisedBy, setRaisedBy] = useState(RAISERS[0].name);

  const material = materials.find((m) => m.code === code) || null;

  // The last rate this material was actually bought at, which is what the server will use
  // unless a rate is typed. Read from the documents already on screen so the form can show
  // the same number the server will reach on its own.
  const knownRate = useMemo(() => {
    const bought = data.documents
      .filter((d) => d.materialCode === code && Number(d.rate) > 0)
      .sort((a, b) => Number(b.rate) - Number(a.rate))[0];
    return bought ? Number(bought.rate) : 0;
  }, [data.documents, code]);

  const effectiveRate = Number(rate) > 0 ? Number(rate) : knownRate;
  const basic = Math.round((Number(quantity) || 0) * effectiveRate);
  const ready = Boolean(material && Number(quantity) > 0 && effectiveRate > 0);

  function submit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    onCreate({
      materialCode: code,
      plant: material.plant,
      quantity: Number(quantity),
      rate: Number(rate) > 0 ? Number(rate) : undefined,
      neededBy,
      reason,
      raisedBy
    });
    setQuantity('');
    setRate('');
    setReason('');
  }

  if (!canDecide) {
    return (
      <Banner kind="err" icon="alert">
        Requisitions cannot be raised against this data source, because nothing can be
        saved to it. Switch DATA_SOURCE to <b>excel</b> or <b>db</b> and restart the backend.
      </Banner>
    );
  }

  return (
    <>
      <Banner kind="info" icon="doc">
        <b>Raise a requisition.</b> It asks for a material rather than committing to buy
        one, so no vendor is named yet and no terms are agreed. Once it is approved it can
        be turned into a purchase order.
      </Banner>

      <Card span="c6" icon="doc" tone="pri" title="New requisition" subtitle="what is needed, and why">
        <form onSubmit={submit}>
          <div className="mlab">Material</div>
          <select className="sel" value={code} onChange={(e) => { setCode(e.target.value); setRate(''); }}>
            <option value="">Choose a material…</option>
            {materials.map((m) => (
              <option key={`${m.code}-${m.plant}`} value={m.code}>
                {m.name} — {m.code} at {m.plant}
              </option>
            ))}
          </select>

          <div className="mlab">Quantity{material ? ` (${material.unit})` : ''}</div>
          <input
            className="minp"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={material ? `How many ${material.unit}?` : 'Choose a material first'}
            disabled={!material}
          />

          <div className="mlab">
            Rate {material ? `per ${material.unit}` : ''}
            {knownRate > 0 ? <span className="mut"> — last bought at {inr(knownRate)}, leave blank to use it</span> : null}
          </div>
          <input
            className="minp"
            type="number"
            min="1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={knownRate > 0 ? String(knownRate) : 'No rate on file — enter an estimate'}
            disabled={!material}
          />

          <div className="mlab">Needed by</div>
          <input
            className="minp"
            value={neededBy}
            onChange={(e) => setNeededBy(e.target.value)}
            placeholder="e.g. 30 Sep 2026"
          />

          <div className="mlab">Raised on behalf of</div>
          <select className="sel" value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)}>
            {RAISERS.map((r) => (
              <option key={r.name} value={r.name}>{r.name} — {r.title}</option>
            ))}
          </select>

          <div className="mlab">Why it is needed</div>
          <textarea
            className="noteinput"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="The buyer and every approver sees this."
          />

          <div className="tacts">
            <button className="btn" type="submit" disabled={!ready || Boolean(busy)}>
              {busy ? 'Raising…' : 'Raise requisition'}
            </button>
          </div>
        </form>
      </Card>

      <Card span="c6" icon="eye" tone={basic >= PR_ALONE_LIMIT ? 'warn' : 'pos'} title="What this will create" subtitle="before it exists">
        {material ? (
          <>
            <div className="kv"><span>Material</span><b>{material.name}</b></div>
            <div className="kv"><span>Plant</span><b>{material.plant}</b></div>
            <div className="kv">
              <span>Quantity</span>
              <b>{quantity ? `${num(Number(quantity))} ${material.unit}` : '—'}</b>
            </div>
            <div className="kv">
              <span>Rate</span>
              <b>{effectiveRate ? `${inr(effectiveRate)} per ${material.unit}` : 'not known'}</b>
            </div>
            <div className="kv"><span>Value</span><b>{basic ? inr(basic) : '—'}</b></div>
            <div className="kv"><span>Raised by</span><b>{raisedBy}</b></div>
            <div className="kv"><span>Document number</span><b className="mut">given when you raise it</b></div>

            <div className="footnote">
              <Chip tone={basic >= PR_ALONE_LIMIT ? 'warn' : 'pos'} icon={basic >= PR_ALONE_LIMIT ? 'alert' : 'check'}>
                {basic >= PR_ALONE_LIMIT ? 'Needs a second signature' : 'Yours to release'}
              </Chip>{' '}
              {chainNote(basic)}
            </div>

            <div className="footnote mut">
              In stock now: {num(material.onHand)} {material.unit}
              {material.openOrderQuantity > 0 ? `, with ${num(material.openOrderQuantity)} already on order` : ''}.
            </div>
          </>
        ) : (
          <div className="mut">Choose a material and the requisition will be described here before anything is created.</div>
        )}

        <SimulatedNote>
          The rate is the last price this material was bought at, not a quotation. A
          requisition asks for something; what it will actually cost is settled when a
          vendor is chosen on the purchase order.
        </SimulatedNote>
      </Card>
    </>
  );
}
