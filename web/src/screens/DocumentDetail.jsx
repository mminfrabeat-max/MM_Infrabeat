// One purchasing document, in full.
//
// The card order is the order a head of department actually thinks in:
//   1. What am I being asked to approve, and what does the record say
//   2. What happens either way, priced
//   3. Why it is with me and who has already signed
//   4. Where the goods physically are, when that is knowable
//   5. The lines, then the vendor's record

import { useState } from 'react';
import { inr, rupees, num, signed, initials, bandTone, plural } from '../format.js';
import { APPROVER_NAME } from '../brand.js';
import { Card, Banner, Chip, Icon, Facet, TermRow } from '../components/ui.jsx';
import { VendorCharts } from '../components/charts.jsx';
import { SeaJourney, VesselMap, modeIcon } from '../components/journey.jsx';
import { StatusChip } from './Approvals.jsx';
import { materialFor } from '../selectors.js';

export default function DocumentDetail({ data, document, canDecide, onBack, onDecide, busy, error }) {
  const [note, setNote] = useState('');
  const vendor = document.supplierScore;
  const material = materialFor(data.materials, document);
  const tone = vendor?.scored ? bandTone(vendor.band) : 'pri';

  // A document can be waiting and still not be yours to act on: you approved it, and it
  // moved to the person after you. decidedAt is what tells the two apart, and it decides
  // whether the buttons at the foot of the page appear at all.
  const decided = Boolean(document.decidedAt);
  const mayDecide = canDecide && document.status === 'pending' && !decided;
  const handedOn = document.status === 'pending' && decided && document.next;

  // The next approver appears only once the decision is made.
  //
  // Naming them beforehand answers a question nobody has yet, and quietly changes the one
  // being asked: "is this order sound" becomes "what will Finance think of it". Who it goes
  // to afterwards is useful; who it would go to is a hint. So the card stays out of the way
  // until approving has made it a fact.
  //
  // A document that was sent back never reaches them, so it is never shown there either.
  const showNext = Boolean(handedOn);

  return (
    <>
      <section className="ohero">
        <div className="ohero-in">
          <button className="oback" onClick={onBack} type="button">
            <Icon name="back" size={14} />
            Back to the list
          </button>

          <div className="otitle">
            <span className="oav">{initials(document.supplierName)}</span>
            <div>
              <h1>{document.kind} {document.id}</h1>
              <div className="os">
                {document.material} &middot; {document.supplierName} &middot; {document.plant} plant &middot; {document.docType}
              </div>
            </div>
            <span style={{ marginLeft: 'auto' }}><StatusChip status={document.status} document={document} /></span>
          </div>

          <div className="facets">
            <Facet label="Total value" value={inr(document.total)} />
            <Facet
              label={document.items.length > 1 ? 'Items' : 'Quantity'}
              value={document.items.length > 1 ? `${document.items.length} lines` : `${num(document.quantity)} ${document.unit}`}
            />
            <Facet label="Rate" value={document.items.length > 1 ? 'per item below' : rupees(document.rate)} />
            <Facet label="Type" value={document.trade} />
            <Facet label="Transport" value={document.transport} />
            <Facet label="Delivery" value={document.deliveryDate} />
            <Facet label="Waiting" value={`${document.hoursWaiting} h`} />
          </div>
        </div>
      </section>

      <Banner kind={tone === 'neg' ? 'err' : tone === 'warn' ? 'warn' : 'ok'} icon="spark">
        <b>Before you approve.</b> {document.advice}
      </Banner>

      {error && (
        <Banner kind="err" icon="alert">
          <b>Not saved.</b> {error}
        </Banner>
      )}

      <div className="grid">
        {mayDecide && (
          <Card
            span="c12"
            icon="spark"
            tone="warn"
            title="What happens either way"
            subtitle="the same decision, priced both ways"
          >
            <div className="conseq">
              <div className="cq yes">
                <div className="cqh"><Icon name="check" size={13} />If you approve</div>
                <div className="cqt">{document.consequence.ifApproved}</div>
              </div>
              <div className="cq no">
                <div className="cqh"><Icon name="back" size={13} />If you send it back</div>
                <div className="cqt">{document.consequence.ifSentBack}</div>
              </div>
            </div>
          </Card>
        )}

        <Card span="c7" icon="doc" tone="pri" title="Order header" subtitle="everything you need in one place">
          <div className="terms">
            <div>
              <TermRow label="Order number" value={`${document.kind} ${document.id}`} />
              <TermRow label="Document type" value={document.docType} />
              <TermRow label="Domestic or import" value={document.trade} />
              <TermRow label="Incoterm" value={document.incoterm} />
              <TermRow
                label="Mode of transport"
                value={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon name={modeIcon(document.transport)} size={14} />
                    {document.transport}
                  </span>
                }
              />
              <TermRow label="Delivery date" value={document.deliveryDate} />
              <TermRow label="Plant" value={document.plant} />
            </div>
            <div>
              <TermRow
                label="Vendor"
                value={vendor ? `${vendor.name} (${vendor.supplierId}), ${vendor.city}` : document.supplierName}
              />
              <TermRow label="GST number" value={vendor ? `${vendor.gst}${vendor.iec ? `, ${vendor.iec}` : ''}` : '–'} />
              <TermRow label="Payment terms" value={document.payTerms} />
              <TermRow label="Cash discount" value={document.cashDiscount} />
              <TermRow label="Supplier rebate" value={document.rebate} />
              <TermRow
                label="Vendor standing"
                value={vendor?.scored ? `${vendor.total} out of 100, ${vendor.bandLabel.toLowerCase()}` : 'not scored'}
              />
              <TermRow
                label="Contract rate"
                value={
                  vendor
                    ? `${rupees(vendor.contractRate)} per ${vendor.unit}, this order is ${signed(document.percentOverContract)}`
                    : '–'
                }
              />
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div className="terms">
              <div>
                <TermRow label="Basic value" value={inr(document.basic)} />
                <TermRow
                  label="Freight charges"
                  value={document.freight ? inr(document.freight) : document.trade === 'Import' ? 'Included in CIF price' : 'Not applicable'}
                />
              </div>
              <div>
                <TermRow label="Loading charges" value={document.loading ? inr(document.loading) : 'Not applicable'} />
                <TermRow label="Total payable" value={inr(document.total)} big />
              </div>
            </div>
          </div>
        </Card>

        <Card span="c5" icon="people" tone="pri" title="Who has approved so far" subtitle="and who it is with now">
          {/* One list, drawn as a line. Each row carries `done` or `wait`, and the connector
              below the dot takes its colour from that: solid green for a step that has
              happened, dashed red for one still to come. The state is on the row rather
              than worked out in CSS, because the row is the only thing that knows it. */}
          <div className="chain">
            {/* Who raised it. First in the list because that is where the document started,
                and because they are the person told about every decision made on it. */}
            {document.createdBy && (
              <div className="stepline done">
                <span className="sd bg-mut"><Icon name="doc" size={13} /></span>
                <div>
                  <div className="s1">{document.createdBy.name}</div>
                  {/* Name and role, never the address. Who someone is belongs on screen;
                      where their mail goes is the backend's business and nobody else's. */}
                  <div className="s2">
                    Raised this {document.kind}
                    {document.createdBy.title ? `, ${document.createdBy.title}` : ''}
                    {document.createdBy.when ? ` on ${document.createdBy.when}` : ''}
                  </div>
                </div>
              </div>
            )}

            {document.prev ? (
              <div className="stepline done">
                <span className="sd bg-pos"><Icon name="check" size={13} /></span>
                <div>
                  <div className="s1">{document.prev.name}</div>
                  <div className="s2">{document.prev.level}, approved {document.prev.when}</div>
                  <div className="s2" style={{ fontStyle: 'italic' }}>&ldquo;{document.prev.note}&rdquo;</div>
                </div>
              </div>
            ) : (
              <div className="stepline done">
                <span className="sd bg-mut">1</span>
                <div>
                  <div className="s1">No one yet</div>
                  <div className="s2">You are the first approval on this order</div>
                </div>
              </div>
            )}

            {document.status === 'pending' && !decided ? (
              <div className="stepline wait">
                <span className="sd bg-neg"><Icon name="clock" size={13} /></span>
                <div>
                  <div className="s1">{APPROVER_NAME} (you), now</div>
                  <div className="s2">{document.step}, waiting {document.hoursWaiting} hours</div>
                  <div className="s2">{document.reason}</div>
                </div>
              </div>
            ) : (
              <div className={`stepline ${document.status === 'rejected' ? 'wait' : 'done'}`}>
                <span className={`sd bg-${document.status === 'rejected' ? 'neg' : 'pos'}`}>
                  <Icon name={document.status === 'rejected' ? 'alert' : 'check'} size={13} />
                </span>
                <div>
                  {/* The name. decidedBy is the address the decision was stamped with, which
                      is how the sign-in works, not how a person is called. */}
                  <div className="s1">{APPROVER_NAME} (you)</div>
                  <div className="s2">
                    {handedOn ? document.prev?.level || 'your step' : document.step},{' '}
                    {document.status === 'rejected' ? 'sent back' : 'approved'}
                    {document.decidedAt ? ` at ${document.decidedAt}` : ''}
                  </div>
                  {document.decisionNote && <div className="s2" style={{ fontStyle: 'italic' }}>&ldquo;{document.decisionNote}&rdquo;</div>}
                </div>
              </div>
            )}

            {/* The step after this one. Shown, never actionable: this dashboard belongs to one
                manager, and the person named here approves in their own system, not in yours.
                Saying so on the row is the honest version of greying out a button. */}
            {showNext && (
              <div className="stepline wait">
                <span className="sd bg-neg"><Icon name="clock" size={13} /></span>
                <div>
                  <div className="s1">
                    {document.next.name}
                    <span style={{ marginLeft: 8 }}>
                      <Chip tone="mut" icon="eye">Display only</Chip>
                    </span>
                  </div>
                  <div className="s2">
                    {[document.next.title, document.next.level].filter(Boolean).join(' · ')}
                  </div>
                  <div className="s2">
                    Waiting with them since you approved it{document.decidedAt ? ` at ${document.decidedAt}` : ''}.
                    They have been mailed.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flagline">
            <Icon name="shield" size={14} />
            {/* Before the decision this says there IS a further step, without saying who is
                on it. That the order will not be released yet changes how you read it; who
                signs it next does not, and should not. */}
            {handedOn
              ? `Approved under your own name. ${document.createdBy ? `${document.createdBy.name} has been told by mail.` : 'The buyer has been told by mail.'}`
              : mayDecide && document.next
                ? 'Approving does not release this order. There is one more approval after yours, and the buyer is mailed either way.'
                : 'Approved under your own name, as if you had done it in SAP.'}
          </div>
        </Card>

        {document.vessel && (
          <Card span="c12" icon="ship" tone="warn" title="Where the shipment is" subtitle="live position, not a note somebody typed">
            {/* The shape of the journey first, the numbers under it. Which leg it is on and
                whether that leg has started are the two things you want at a glance; the
                bill of lading is what you want once you have them. */}
            <SeaJourney vessel={document.vessel} plant={document.plant} />

            <VesselMap vessel={document.vessel} />

            <div className="terms" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div>
                <TermRow label="Vessel" value={`${document.vessel.name}, IMO ${document.vessel.imo}`} />
                <TermRow label="Bill of lading" value={document.vessel.billOfLading} />
                <TermRow label="Route" value={`${document.vessel.from} to ${document.vessel.to}`} />
              </div>
              <div>
                <TermRow label="Position now" value={document.vessel.position} />
                <TermRow label={`ETA ${document.vessel.to}`} value={`${document.vessel.eta}, against ${document.deliveryDate} on the order`} />
                <TermRow label="After it lands" value={document.vessel.afterPort} />
              </div>
            </div>

            {material && (
              <div className="cq no" style={{ marginTop: 14 }}>
                <div className="cqh"><Icon name="alert" size={13} />What this means</div>
                <div className="cqt">
                  {document.plant} has {Math.floor(material.onHand / material.dailyUsage)} days of cover on {material.name} at
                  today&rsquo;s use, and the sea leg alone is {material.leadTimeDays} days. The gap is real, so the order
                  cannot wait for the next approval round.
                </div>
              </div>
            )}

            <div className="feed">
              <span className="outside">Outside SAP</span>
              {document.vessel.source}, as of {document.vessel.updated} today. SAP holds the order, not the ship.
            </div>
          </Card>
        )}

        <Card
          span="c12"
          icon="box"
          tone="pri"
          title="Items on this order"
          subtitle={`${plural(document.items.length, 'line')}, with material type and material group`}
          flush
        >
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Material</th>
                <th>Material number</th>
                <th>Material type</th>
                <th>Material group</th>
                <th className="rt">Quantity</th>
                <th className="rt">Rate</th>
                <th className="rt">Value</th>
              </tr>
            </thead>
            <tbody>
              {document.items.map((it) => (
                <tr key={it.pos}>
                  <td className="n">{it.pos}</td>
                  <td><b>{it.material}</b></td>
                  <td className="n">{it.materialCode}</td>
                  <td>
                    {it.type
                      ? (<><Chip tone="mut">{it.type}</Chip><div className="sub">{it.typeText}</div></>)
                      : <span className="sub">not maintained</span>}
                  </td>
                  <td>
                    {it.group
                      ? (<>{it.group}<div className="sub">{it.groupText}</div></>)
                      : <span className="sub">not maintained</span>}
                  </td>
                  <td className="rt n">{num(it.quantity)} {it.unit}</td>
                  <td className="rt n">{rupees(it.rate)}</td>
                  <td className="rt n"><b>{inr(it.quantity * it.rate)}</b></td>
                </tr>
              ))}
              <tr>
                <td />
                <td colSpan={6}>
                  <b>Basic value, all items</b>
                  <div className="sub">freight and loading are shown in the order header</div>
                </td>
                <td className="rt n"><b>{inr(document.basic)}</b></td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card span="c12" icon="truck" tone={tone} title="How this vendor has performed" subtitle="their last ten orders with us">
          <VendorCharts vendor={vendor} />
        </Card>
      </div>

      {mayDecide && (
        <div className="footerbar">
          <span className="muted" style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="shield" size={13} /> Approving as {APPROVER_NAME}
          </span>
          <input
            className="noteinput"
            placeholder="Approval note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy !== null || !canDecide}
          />
          <button className="btn rej" onClick={() => onDecide('reject', note)} disabled={busy !== null || !canDecide} type="button">
            {busy === 'reject' ? 'Saving…' : 'Send back'}
          </button>
          {/* The label says what the button does. On a two step order "Approve" would read
              as "release this order", which is not what pressing it does. */}
          <button className="btn emph" onClick={() => onDecide('approve', note)} disabled={busy !== null || !canDecide} type="button">
            <Icon name="check" size={13} />
            {/* The label says what pressing it does. "Approve" on a two step order would
                read as "release this order", which is not what happens. It says there is a
                next step without saying who is on it. */}
            {busy === 'approve' ? 'Saving…' : document.next ? 'Approve and pass on' : 'Approve'}
          </button>
        </div>
      )}
    </>
  );
}
