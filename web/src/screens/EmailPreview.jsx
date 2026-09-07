// What actually lands in the approver's inbox.
//
// This is not decoration. The point of the whole dashboard is that a decision can be made
// from a phone at a plant gate, so the mail has to carry the full header and the vendor
// trend with it. Showing it on screen is how you check that it does.
//
// The buttons here approve for real, the same as on the document page: they write to the
// workbook and send the notification.

import { useState } from 'react';
import { inr, rupees, bandTone } from '../format.js';
import { Banner, Chip, Icon, TermRow } from '../components/ui.jsx';
import { VendorCharts } from '../components/charts.jsx';
import { byPlant } from '../selectors.js';

export default function EmailPreview({ data, plant, mailTo, canDecide, onDecide, busy }) {
  const documents = byPlant(data.documents, plant);
  const pendingFirst = [...documents].sort((a, b) => {
    if (a.status === b.status) return b.hoursWaiting - a.hoursWaiting;
    return a.status === 'pending' ? -1 : 1;
  });

  const [selectedId, setSelectedId] = useState(pendingFirst[0]?.id || null);
  const document = documents.find((d) => d.id === selectedId) || pendingFirst[0];

  if (!document) {
    return <Banner icon="mail">Nothing to show for {plant}.</Banner>;
  }

  const vendor = document.supplierScore;
  const tone = vendor?.scored ? bandTone(vendor.band) : 'pri';

  return (
    <>
      <Banner icon="mail">
        This is what arrives at <b>{mailTo}</b>. The full header travels with it, so the
        decision can be made from the phone.
      </Banner>

      <div style={{ display: 'flex', gap: 9, marginBottom: 13, flexWrap: 'wrap' }}>
        {pendingFirst.map((d) => (
          <button
            key={d.id}
            className={`btn sm ${d.id === document.id ? 'emph' : 'q'}`}
            type="button"
            onClick={() => setSelectedId(d.id)}
          >
            {d.kind} {d.id}
            {d.status !== 'pending' && ` · ${d.status === 'approved' ? 'approved' : 'sent back'}`}
          </button>
        ))}
      </div>

      <div className="mail">
        <div className="mailtop">
          <span className="gm">M</span>
          Inbox
          <span style={{ flex: 1 }} />
          <span className="n">{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        <div className="mailhd">
          <div className="sj">
            Approval needed: {document.kind} {document.id}, {document.supplierName}, {inr(document.total)}
          </div>
          <div className="mfrom">
            <span className="av">PD</span>
            <div>
              <div style={{ color: 'var(--ink)', fontSize: '13.2px', fontWeight: 600 }}>Procurement dashboard</div>
              <div>to {mailTo}</div>
            </div>
          </div>
        </div>

        <div className="mailbd">
          <p style={{ margin: '0 0 12px' }}>
            {document.kind} {document.id} has been waiting {document.hoursWaiting} hours.{' '}
            {document.prev
              ? `${document.prev.name} approved it at ${document.prev.level.toLowerCase()} on ${document.prev.when}.`
              : 'You are the first approver.'}
          </p>

          <div className="mcard">
            <div className="mh">
              <div>
                <div style={{ fontSize: '13.8px', fontWeight: 650 }}>{document.material}</div>
                <div className="sub">
                  {document.supplierName}, {document.plant} plant, {document.trade.toLowerCase()}, {document.incoterm}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '16px', fontWeight: 700 }} className="n">{inr(document.total)}</div>
                <div className="sub n">{document.quantity} {document.unit} at {rupees(document.rate)}</div>
              </div>
            </div>

            <div className="mb">
              <div className="terms">
                <div>
                  <TermRow label="Document type" value={document.docType} />
                  <TermRow label="Transport" value={document.transport} />
                  <TermRow label="Payment terms" value={document.payTerms} />
                  <TermRow label="GST number" value={vendor ? vendor.gst : '–'} />
                </div>
                <div>
                  <TermRow label="Freight" value={document.freight ? inr(document.freight) : 'included'} />
                  <TermRow label="Loading" value={document.loading ? inr(document.loading) : 'nil'} />
                  <TermRow label="Cash discount" value={document.cashDiscount} />
                  <TermRow label="Rebate" value={document.rebate} />
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <VendorCharts vendor={vendor} />
              </div>

              <div className="reco" style={{ background: `var(--${tone}-soft)` }}>
                <span style={{ flex: 'none' }}><Icon name="spark" size={15} /></span>
                <div><b>Before you approve.</b> {document.advice}</div>
              </div>
            </div>

            <div className="mf">
              {document.status === 'pending' ? (
                <>
                  <button
                    className="btn emph"
                    type="button"
                    disabled={!canDecide || busy !== null}
                    onClick={() => onDecide(document.id, 'approve')}
                  >
                    <Icon name="check" size={13} />
                    {busy === 'approve' ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    className="btn rej"
                    type="button"
                    disabled={!canDecide || busy !== null}
                    onClick={() => onDecide(document.id, 'reject')}
                  >
                    {busy === 'reject' ? 'Saving…' : 'Send back'}
                  </button>
                </>
              ) : (
                <Chip tone={document.status === 'approved' ? 'pos' : 'neg'}>
                  {document.status === 'approved' ? 'Approved' : 'Sent back'}
                  {document.decidedAt ? ` at ${document.decidedAt}` : ''}
                </Chip>
              )}
            </div>
          </div>

          <p style={{ margin: '14px 0 0', fontSize: '12.3px', color: 'var(--ink-3)', lineHeight: 1.6 }}>
            The mail is sent from the dashboard&rsquo;s own mailbox when a decision is recorded.
            The audit trail in the workbook holds who decided, when, and whether the mail left.
          </p>
        </div>
      </div>
    </>
  );
}
