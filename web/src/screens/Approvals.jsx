// Two screens in one file, because they are the same subject at two zoom levels:
// the list of everything waiting, and the full picture for one document.

import { useState } from 'react';
import { useApi } from '../useApi.js';
import { api } from '../api.js';
import { money, rupees, number, signedPercent, documentTypeLabel, initials } from '../format.js';
import { Card, Chip, Score, Banner, Loading, ErrorPanel, Icon, bandTone } from '../components/ui.jsx';
import { SupplierCharts } from '../components/charts.jsx';

export default function Approvals({ selectedId, onNavigate }) {
  // When a document is selected we show the detail screen instead of the list.
  if (selectedId) return <ApprovalDetail id={selectedId} onNavigate={onNavigate} />;
  return <ApprovalList onNavigate={onNavigate} />;
}

function ApprovalList({ onNavigate }) {
  const { state, data, error, reload } = useApi(api.approvals);

  if (state === 'loading') return <Loading what="the approval list" />;
  if (state === 'error') return <ErrorPanel message={error} onRetry={reload} />;

  const documents = [...data.documents].sort((a, b) => b.hoursWaiting - a.hoursWaiting);

  return (
    <>
      <Banner icon="eye">
        Open any document to see why it is waiting, how this supplier has performed over
        their last ten orders, and what we suggest doing about it.
      </Banner>

      <Card span="c12" flush title="Everything waiting for a decision" subtitle="longest wait first" icon="doc" tone="warn">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Supplier</th>
              <th>Plant</th>
              <th className="rt">Value</th>
              <th>Step</th>
              <th>Waiting</th>
              <th>Supplier score</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={d.id} onClick={() => onNavigate('approvals', d.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <b>{documentTypeLabel(d.type)} {d.id}</b>
                  <div className="sub">{d.material}</div>
                </td>
                <td>{d.supplierName}</td>
                <td>{d.plant}</td>
                <td className="rt n"><b>{money(d.value)}</b></td>
                <td className="stepcell">{d.step}</td>
                <td>
                  <Chip tone={d.hoursWaiting > 48 ? 'neg' : d.hoursWaiting > 24 ? 'warn' : 'mut'}>
                    {d.hoursWaiting} h
                  </Chip>
                </td>
                <td>
                  {d.supplierScore?.scored ? (
                    <Score value={d.supplierScore.total} band={d.supplierScore.band} size="14px" />
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td><StatusChip status={d.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function ApprovalDetail({ id, onNavigate }) {
  // The [id] second argument tells the hook to reload whenever a different document is
  // opened. Without it, clicking a second document would keep showing the first.
  const { state, data, error, reload } = useApi(() => api.approval(id), [id]);

  if (state === 'loading') return <Loading what={`document ${id}`} />;
  if (state === 'error') {
    return (
      <>
        <BackLink onNavigate={onNavigate} />
        <ErrorPanel message={error} onRetry={reload} />
      </>
    );
  }

  const d = data.document;
  const supplier = d.supplierScore;
  const recommendationTone =
    d.recommendation.verdict === 'hold' ? 'err' : d.recommendation.verdict === 'approve' ? 'ok' : 'warn';

  return (
    <>
      <section className="ohero">
        <div className="ohero-in">
          <button className="oback" onClick={() => onNavigate('approvals')} type="button">
            <Icon name="back" size={14} />
            All documents
          </button>

          <div className="otitle">
            <span className="oav">{initials(d.supplierName)}</span>
            <div>
              <h1>{documentTypeLabel(d.type)} {d.id}</h1>
              <div className="os">
                {d.material} · {d.supplierName} · plant {d.plant}
              </div>
            </div>
            <span style={{ marginLeft: 'auto' }}><StatusChip status={d.status} /></span>
          </div>

          <div className="facets">
            <Facet label="Value" value={money(d.value)} />
            <Facet label="Quantity" value={`${number(d.quantity)} ${d.unit}`} />
            <Facet label="Price" value={rupees(d.rate)} />
            <Facet label="Delivery" value={d.deliveryDate} />
            <Facet label="Waiting" value={`${d.hoursWaiting} h`} />
            <Facet label="Supplier score" value={supplier?.scored ? `${supplier.total} / 100` : 'not scored'} />
          </div>
        </div>
      </section>

      <Banner kind={recommendationTone} icon="spark">
        <b>What we suggest: {d.recommendation.verdict}.</b> {d.recommendation.text}
      </Banner>

      <div className="grid">
        <Card span="c5" icon="shield" tone="pri" title="Why it is with you" subtitle="the rule and the current step">
          <dl className="kv">
            <dt>Rule</dt>
            <dd>{d.rule}</dd>
            <dt>Current step</dt>
            <dd>{d.step}</dd>
            <dt>Sitting with</dt>
            <dd>{d.heldWith}</dd>
            <dt>Why it has not moved</dt>
            <dd>{d.reason}</dd>
            <dt>Material</dt>
            <dd>{d.material} ({d.materialCode})</dd>
            <dt>Agreed price</dt>
            <dd className="n">
              {rupees(d.contractRate)} per {d.unit}{' '}
              <b className={d.percentOverContract > 0 ? 'neg' : 'pos'}>
                {signedPercent(d.percentOverContract)}
              </b>
            </dd>
          </dl>
        </Card>

        <Card
          span="c7"
          icon="chart"
          tone={bandTone(supplier?.band)}
          title="How this supplier has performed"
          subtitle="delivery, quality and price over their last ten orders"
        >
          <SupplierCharts supplier={supplier} />
        </Card>

        {supplier?.scored && (
          <Card span="c12" icon="doc" tone="pri" title="The ten orders behind that trend" subtitle="the same data, as numbers" flush>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Month</th>
                  <th className="rt">Value</th>
                  <th className="rt">Delivery</th>
                  <th className="rt">Quality</th>
                  <th className="rt">Price</th>
                </tr>
              </thead>
              <tbody>
                {[...supplier.history].reverse().map((o) => (
                  <tr key={o.order}>
                    <td className="n">{o.order}</td>
                    <td>{o.month}</td>
                    <td className="rt n">{money(o.value)}</td>
                    <td className="rt">
                      <Chip tone={o.daysLate > 3 ? 'neg' : o.daysLate > 0 ? 'warn' : 'pos'}>
                        {o.daysLate > 0 ? '+' : ''}{o.daysLate} d
                      </Chip>
                    </td>
                    <td className={`rt n ${o.qualityPercent < 97 ? 'warn' : 'pos'}`}>{o.qualityPercent}%</td>
                    <td className={`rt n ${o.rate > supplier.contractRate ? 'neg' : ''}`}>{rupees(o.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {d.status === 'pending' ? (
        <DecisionBar document={d} onDecided={reload} />
      ) : (
        <DecisionRecord document={d} />
      )}
    </>
  );
}

// The approve and reject controls.
//
// Two things it must get right. First, the buttons disable while the request is in
// flight, so an impatient second click cannot send a second decision. Second, saving to
// the workbook and sending the email are reported separately, because the first can
// succeed while the second fails and you need to know which happened.
function DecisionBar({ document, onDecided }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null); // 'approve' | 'reject' | null
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function decide(action) {
    setBusy(action);
    setError(null);
    try {
      const response = action === 'approve'
        ? await api.approve(document.id, note)
        : await api.reject(document.id, note);
      setResult(response);
      // Re-fetch so the header, the status chip and the record below all update.
      onDecided();
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  if (result) {
    return (
      <Banner kind={result.email.sent ? 'ok' : 'warn'} icon={result.email.sent ? 'check' : 'alert'}>
        <b>{documentTypeLabel(document.type)} {document.id} {result.status}.</b>{' '}
        Saved to the workbook.{' '}
        {result.email.sent
          ? `A notification was emailed to ${result.email.to}.`
          : `The email did not go out: ${result.email.status.replace(/^Not sent: /, '')}`}
      </Banner>
    );
  }

  return (
    <>
      {error && (
        <Banner kind="err" icon="alert">
          <b>Not saved.</b> {error}
        </Banner>
      )}

      <div className="footerbar">
        <input
          className="noteinput"
          placeholder="Add a note, optional. It is saved and included in the email."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy !== null}
        />
        <button className="btn rej" onClick={() => decide('reject')} disabled={busy !== null} type="button">
          {busy === 'reject' ? 'Saving…' : 'Reject'}
        </button>
        <button className="btn emph" onClick={() => decide('approve')} disabled={busy !== null} type="button">
          <Icon name="check" size={13} />
          {busy === 'approve' ? 'Saving…' : 'Approve'}
        </button>
      </div>
    </>
  );
}

// Shown once a decision has been made, so reopening the document tells you what happened.
function DecisionRecord({ document }) {
  const approved = document.status === 'approved';
  return (
    <Banner kind={approved ? 'ok' : 'err'} icon={approved ? 'check' : 'alert'}>
      <b>{approved ? 'Approved' : 'Rejected'}</b>
      {document.decidedBy ? ` by ${document.decidedBy}` : ''}
      {document.decidedAt ? ` on ${document.decidedAt}` : ''}
      {document.decisionNote ? `. Note: ${document.decisionNote}` : '.'}
    </Banner>
  );
}

function Facet({ label, value }) {
  return (
    <div className="facet">
      <div className="fl">{label}</div>
      <div className="fv n">{value}</div>
    </div>
  );
}

function BackLink({ onNavigate }) {
  return (
    <button className="btn" onClick={() => onNavigate('approvals')} type="button" style={{ marginBottom: 14 }}>
      <Icon name="back" size={13} /> All documents
    </button>
  );
}

function StatusChip({ status }) {
  if (status === 'approved') return <Chip tone="pos" icon="check">Approved</Chip>;
  if (status === 'rejected') return <Chip tone="neg">Rejected</Chip>;
  return <Chip tone="warn" icon="clock">Waiting</Chip>;
}
