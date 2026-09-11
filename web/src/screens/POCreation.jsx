// Raising a purchase order.
//
// The second step of the P2P cycle. A requisition asks for something; an order commits to
// buying it from a named vendor at an agreed price, which is why a vendor is required here
// and was not on the requisition.
//
// The ordinary way in is to convert a requisition that has finished its approvals, so the
// left-hand list comes first: material, plant and quantity carry across and only the
// commercial terms have to be decided. Raising one directly is possible but secondary,
// because an order with no requisition behind it is an order nobody asked for.

import { useMemo, useState } from 'react';
import { inr, num } from '../format.js';
import { byPlant } from '../selectors.js';
import { Card, Banner, Chip, SimulatedNote } from '../components/ui.jsx';

// The same bands as server/src/domain/creation.js, for explaining the chain as it is typed.
// The server decides for real; if the two ever disagree, the server is right.
const PO_ALONE_LIMIT = 10000000; // one crore
const PO_DIRECTOR_LIMIT = 50000000; // five crore, the manager's release limit

function chainNote(basic) {
  if (!basic) return 'Enter a quantity and a vendor to see who will need to approve it.';
  if (basic < PO_ALONE_LIMIT) return 'Under one crore, so you can release this order yourself.';
  if (basic < PO_DIRECTOR_LIMIT) return 'One crore or more, so it goes to Mr. Kiran Raghavan, Finance head, after you.';
  return 'Above your five crore release limit, so it goes to Mr. Sunil Kulkarni, Director, Operations, after you.';
}

// Requisitions that have finished every approval and have not already been spent.
//
// "Not already spent" is the important half: a requisition says something is needed once,
// so an order created from it takes it off this list for good. Without that a single
// request could quietly become two orders.
export function convertibleRequisitions(documents, plant) {
  const spent = new Set(documents.map((d) => d.sourceDocument).filter(Boolean));
  return byPlant(documents, plant).filter(
    (d) => d.kind === 'PR' && d.status === 'approved' && !spent.has(d.id)
  );
}

export default function POCreation({ data, plant, canDecide, onCreate, busy }) {
  const ready = convertibleRequisitions(data.documents, plant);
  const vendors = useMemo(
    () => [...(data.suppliers || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [data.suppliers]
  );
  const materials = byPlant(data.materials, plant);

  const [fromRequisition, setFromRequisition] = useState('');
  const [code, setCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [rate, setRate] = useState('');
  const [freight, setFreight] = useState('');
  const [loading, setLoading] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const [transport, setTransport] = useState('Road');
  const [payTerms, setPayTerms] = useState('30 days from receipt');
  const [deliveryDate, setDeliveryDate] = useState('');

  const source = ready.find((d) => d.id === fromRequisition) || null;
  const vendor = vendors.find((v) => v.supplierId === supplierId) || null;

  // A converted order takes its material and quantity from the requisition; a direct one
  // needs them chosen here.
  const materialCode = source ? source.materialCode : code;
  const material = materials.find((m) => m.code === materialCode) || null;
  const materialName = source ? source.material : material?.name || '';
  const unit = source ? source.unit : material?.unit || '';
  const effectiveQuantity = source ? Number(source.quantity) : Number(quantity) || 0;

  const lastRate = useMemo(() => {
    const bought = data.documents
      .filter((d) => d.materialCode === materialCode && Number(d.rate) > 0)
      .sort((a, b) => Number(b.rate) - Number(a.rate))[0];
    return bought ? Number(bought.rate) : 0;
  }, [data.documents, materialCode]);

  const contractRate = Number(vendor?.contractRate) || 0;
  const effectiveRate = Number(rate) > 0 ? Number(rate) : contractRate || Number(source?.rate) || lastRate;
  const basic = Math.round(effectiveQuantity * effectiveRate);
  const total = basic + (Number(freight) || 0) + (Number(loading) || 0);
  const canSubmit = Boolean(materialCode && effectiveQuantity > 0 && supplierId && effectiveRate > 0);

  function choose(id) {
    setFromRequisition(id);
    setCode('');
    setQuantity('');
    setRate('');
    const picked = ready.find((d) => d.id === id);
    if (picked?.deliveryDate) setDeliveryDate(picked.deliveryDate);
  }

  function submit(event) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    onCreate({
      fromRequisition: fromRequisition || undefined,
      materialCode,
      plant: source ? source.plant : material?.plant,
      quantity: effectiveQuantity,
      supplierId,
      rate: Number(rate) > 0 ? Number(rate) : undefined,
      freight: Number(freight) || 0,
      loading: Number(loading) || 0,
      incoterm,
      transport,
      payTerms,
      deliveryDate
    });
    setFromRequisition('');
    setCode('');
    setQuantity('');
    setRate('');
    setFreight('');
    setLoading('');
  }

  if (!canDecide) {
    return (
      <Banner kind="err" icon="alert">
        Orders cannot be raised against this data source, because nothing can be saved to
        it. Switch DATA_SOURCE to <b>excel</b> or <b>db</b> and restart the backend.
      </Banner>
    );
  }

  return (
    <>
      {ready.length > 0 ? (
        <Banner kind="ok" icon="check">
          <b>{ready.length === 1 ? '1 requisition is' : `${ready.length} requisitions are`} approved and waiting to be
          ordered.</b>{' '}
          Converting one carries its material, plant and quantity across, and takes it off
          this list so it cannot be ordered twice.
        </Banner>
      ) : (
        <Banner kind="info" icon="doc">
          <b>No requisitions are waiting to be ordered.</b> One appears here once it has
          finished every approval. You can still raise an order directly below.
        </Banner>
      )}

      <Card span="c6" icon="file" tone="pri" title="New order" subtitle="what is being bought, and from whom">
        <form onSubmit={submit}>
          <div className="mlab">From a requisition</div>
          <select className="sel" value={fromRequisition} onChange={(e) => choose(e.target.value)}>
            <option value="">Raise an order directly (no requisition)</option>
            {ready.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} — {num(d.quantity)} {d.unit} of {d.material} at {d.plant}
              </option>
            ))}
          </select>

          {!source ? (
            <>
              <div className="mlab">Material</div>
              <select className="sel" value={code} onChange={(e) => setCode(e.target.value)}>
                <option value="">Choose a material…</option>
                {materials.map((m) => (
                  <option key={`${m.code}-${m.plant}`} value={m.code}>
                    {m.name} — {m.code} at {m.plant}
                  </option>
                ))}
              </select>

              <div className="mlab">Quantity{unit ? ` (${unit})` : ''}</div>
              <input
                className="minp"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={!material}
                placeholder={material ? `How many ${unit}?` : 'Choose a material first'}
              />
            </>
          ) : (
            <div className="footnote">
              Taking <b>{num(source.quantity)} {source.unit}</b> of <b>{source.material}</b> at{' '}
              <b>{source.plant}</b> from requisition {source.id}, raised by {source.createdBy?.name || 'somebody'}.
            </div>
          )}

          <div className="mlab">Vendor</div>
          <select className="sel" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setRate(''); }}>
            <option value="">Choose a vendor…</option>
            {vendors.map((v) => (
              <option key={v.supplierId} value={v.supplierId}>
                {v.name}{v.city ? ` — ${v.city}` : ''}{v.band ? ` (${v.band})` : ''}
              </option>
            ))}
          </select>

          <div className="mlab">
            Rate {unit ? `per ${unit}` : ''}
            {contractRate > 0 ? <span className="mut"> — contract rate {inr(contractRate)}, leave blank to use it</span> : null}
            {!contractRate && lastRate > 0 ? <span className="mut"> — last paid {inr(lastRate)}</span> : null}
          </div>
          <input className="minp" type="number" min="1" value={rate} onChange={(e) => setRate(e.target.value)}
            placeholder={effectiveRate ? String(effectiveRate) : 'Enter a rate'} />

          <div className="mlab">Freight</div>
          <input className="minp" type="number" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" />

          <div className="mlab">Loading</div>
          <input className="minp" type="number" min="0" value={loading} onChange={(e) => setLoading(e.target.value)} placeholder="0" />

          <div className="mlab">Transport</div>
          <select className="sel" value={transport} onChange={(e) => setTransport(e.target.value)}>
            <option>Road</option>
            <option>Rail</option>
            <option>Sea</option>
          </select>

          <div className="mlab">Incoterm</div>
          <input className="minp" value={incoterm} onChange={(e) => setIncoterm(e.target.value)}
            placeholder={transport === 'Sea' ? 'e.g. CIF, Mundra port' : `e.g. DAP, ${source?.plant || material?.plant || 'plant'}`} />

          <div className="mlab">Payment terms</div>
          <input className="minp" value={payTerms} onChange={(e) => setPayTerms(e.target.value)} />

          <div className="mlab">Delivery</div>
          <input className="minp" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} placeholder="e.g. 30 Sep 2026" />

          <div className="tacts">
            <button className="btn" type="submit" disabled={!canSubmit || Boolean(busy)}>
              {busy ? 'Raising…' : source ? `Convert ${source.id} into an order` : 'Raise order'}
            </button>
          </div>
        </form>
      </Card>

      <Card span="c6" icon="eye" tone={basic >= PO_ALONE_LIMIT ? 'warn' : 'pos'} title="What this will create" subtitle="before it exists">
        {materialCode ? (
          <>
            <div className="kv"><span>Material</span><b>{materialName || materialCode}</b></div>
            <div className="kv"><span>Vendor</span><b>{vendor ? vendor.name : 'not chosen'}</b></div>
            <div className="kv"><span>Quantity</span><b>{effectiveQuantity ? `${num(effectiveQuantity)} ${unit}` : '—'}</b></div>
            <div className="kv"><span>Rate</span><b>{effectiveRate ? `${inr(effectiveRate)} per ${unit}` : 'not known'}</b></div>
            <div className="kv"><span>Basic value</span><b>{basic ? inr(basic) : '—'}</b></div>
            {Number(freight) > 0 ? <div className="kv"><span>Freight</span><b>{inr(Number(freight))}</b></div> : null}
            {Number(loading) > 0 ? <div className="kv"><span>Loading</span><b>{inr(Number(loading))}</b></div> : null}
            <div className="kv"><span>Total payable</span><b>{total ? inr(total) : '—'}</b></div>
            {source ? <div className="kv"><span>From requisition</span><b>{source.id}</b></div> : null}

            <div className="footnote">
              <Chip tone={basic >= PO_ALONE_LIMIT ? 'warn' : 'pos'} icon={basic >= PO_ALONE_LIMIT ? 'alert' : 'check'}>
                {basic >= PO_ALONE_LIMIT ? 'Needs a second signature' : 'Yours to release'}
              </Chip>{' '}
              {chainNote(basic)}
            </div>

            {vendor && vendor.scored ? (
              <div className="footnote mut">
                {vendor.name} over the last {vendor.orderCount} orders: {vendor.onTimePercent}% on time,
                {' '}{vendor.averageDaysLate} days average delay.
              </div>
            ) : null}
          </>
        ) : (
          <div className="mut">
            Choose a requisition to convert, or a material to order directly, and the order
            will be described here before anything is created.
          </div>
        )}

        <SimulatedNote>
          The approval chain is worked out from the order's value, using the same release
          limits as the seeded documents. Nothing is sent to a vendor from here: an order
          reaches them only once it has been released.
        </SimulatedNote>
      </Card>
    </>
  );
}
