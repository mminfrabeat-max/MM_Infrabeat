// One requisition, opened.
//
// Deliberately not the order screen. An order is a commercial document and its detail page
// is laid out as one: vendor, incoterms, freight, payment terms, the vendor's record. None
// of that is settled on a requisition, and showing empty rows for it would suggest it is.
//
// What a requisition is actually asking is "does the plant need this, and how badly". So
// the page leads with the stock position it came out of, then the trail of who has signed
// it and who is holding it now, and puts the money last - which is the reverse of the order
// page, and the right way round for this decision.

import { useState } from 'react';
import { inr, num } from '../format.js';
import { APPROVER_NAME, USER_PROFILE, COMPANY } from '../brand.js';
import { Card, Banner, Chip, Icon, Metric, SimulatedNote } from '../components/ui.jsx';
import { stillNeedsSigning, recordingForNext } from '../selectors.js';

// The urgency band as a colour, matching the list.
function bandTone(band) {
  if (band === 'critical') return 'neg';
  if (band === 'urgent') return 'warn';
  if (band === 'soon') return 'pri';
  return 'mut';
}

function wantedText(priority, deliveryDate) {
  const days = priority?.daysUntilNeeded;
  if (days === null || days === undefined) return deliveryDate || 'no date given';
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return 'wanted today';
  return `wanted in ${days} days`;
}

export default function RequisitionDetail({
  document,
  canDecide,
  busy,
  error,
  onBack,
  onDecide,
  onRemind
}) {
  const [note, setNote] = useState('');
  const priority = document.priority;
  const state = document.approvalState;
  const mayDecide = canDecide && stillNeedsSigning(document);
  const forNext = recordingForNext(document);
  const tone = bandTone(priority?.band);

  // Whoever the reminder would go to. Only somebody other than this manager can be chased:
  // there is no point mailing yourself about a document on your own screen.
  const holder = state?.holder || null;

  return (
    <>
      <button className="btn q oback" type="button" onClick={onBack}>
        <Icon name="back" size={13} /> Back to requisitions
      </button>

      {error && (
        <Banner kind="err" icon="alert">
          {error}
        </Banner>
      )}

      {/* The headline is what is wanted and how urgent it is - not the document number,
          which is only how it is filed. */}
      <Card
        span="c12"
        icon="box"
        tone={tone}
        title={`${num(document.quantity)} ${document.unit} of ${document.material}`}
        subtitle={`${document.plant} plant · requisition ${document.id}`}
        action={<Chip tone={tone} icon={priority?.band === 'critical' ? 'alert' : 'clock'}>{priority?.label || 'No date pressure'}</Chip>}
      >
        <div className="metrics">
          <Metric label="Wanted" value={wantedText(priority, document.deliveryDate)} tone={priority?.daysUntilNeeded < 0 ? 'neg' : 'mut'} />
          <Metric
            label="Days of cover"
            value={priority?.daysOfCover !== null && priority?.daysOfCover !== undefined ? `${priority.daysOfCover} days` : 'not known'}
            note={priority?.leadTimeDays ? `against a ${priority.leadTimeDays} day lead time` : ''}
            tone={priority?.shortfallDays < 0 ? 'neg' : 'pos'}
          />
          <Metric
            label={priority?.shortfallDays < 0 ? 'Runs dry before it lands' : 'Slack'}
            value={priority?.shortfallDays === null || priority?.shortfallDays === undefined
              ? 'not known'
              : `${Math.abs(priority.shortfallDays)} days`}
            tone={priority?.shortfallDays < 0 ? 'neg' : 'pos'}
          />
          <Metric
            label="Short by"
            value={priority?.shortBy > 0 ? `${num(priority.shortBy)} ${priority.unit}` : 'covered'}
            tone={priority?.shortBy > 0 ? 'neg' : 'pos'}
          />
        </div>

        {priority?.reasons?.length > 0 && (
          <div className="cq">
            <div className="cqh">
              <Icon name="eye" size={13} /> Why it is ranked where it is
            </div>
            {priority.reasons.map((reason, i) => (
              <div key={i} className="cqt">{reason}</div>
            ))}
          </div>
        )}
      </Card>

      {/* The trail. On an order this card is about authority levels; here it is about where
          the thing is stuck, because that is the question somebody opening a requisition is
          usually trying to answer. */}
      <Card span="c7" icon="people" tone="pri" title="Where it has got to" subtitle="and who is holding it now">
        <div className="chain">
          <div className="stepline done">
            <span className="sd bg-pos"><Icon name="check" size={13} /></span>
            <div>
              <div className="s1">{document.createdBy ? document.createdBy.name : 'Not recorded'}</div>
              <div className="s2">
                raised it{document.createdBy?.title ? `, ${document.createdBy.title}` : ''}
                {document.createdByWhen ? ` on ${document.createdByWhen}` : ''}
              </div>
              {document.reason && <div className="s2" style={{ fontStyle: 'italic' }}>&ldquo;{document.reason}&rdquo;</div>}
            </div>
          </div>

          {state?.signedBy ? (
            <div className="stepline done">
              <span className="sd bg-pos"><Icon name="check" size={13} /></span>
              <div>
                <div className="s1">{state.signedBy}</div>
                <div className="s2">approved {state.signedAt}</div>
                {document.decisionNote && (
                  <div className="s2" style={{ fontStyle: 'italic' }}>&ldquo;{document.decisionNote}&rdquo;</div>
                )}
              </div>
            </div>
          ) : (
            <div className="stepline wait">
              <span className="sd bg-neg"><Icon name="clock" size={13} /></span>
              <div>
                <div className="s1">{APPROVER_NAME} (you), now</div>
                <div className="s2">{document.step}, waiting {document.hoursWaiting} hours</div>
              </div>
            </div>
          )}

          {state?.state === 'partial' && (
            <div className="stepline wait">
              <span className="sd bg-neg"><Icon name="clock" size={13} /></span>
              <div>
                <div className="s1">{state.holder}</div>
                <div className="s2">
                  {state.holderTitle ? `${state.holderTitle} · ` : ''}has it now, and it is not released until they sign
                </div>
              </div>
            </div>
          )}

          {state?.state === 'approved' && (
            <div className="stepline done">
              <span className="sd bg-pos"><Icon name="check" size={13} /></span>
              <div>
                <div className="s1">Released</div>
                <div className="s2">Every approval is in. It can be turned into an order.</div>
              </div>
            </div>
          )}
        </div>

        {/* Chasing whoever is holding it. Only offered when somebody else is holding it -
            a reminder to yourself about a document already on your screen is noise. */}
        {holder && (
          <div className="tacts">
            <button
              className="btn emph"
              type="button"
              onClick={() => onRemind(document)}
            >
              <Icon name="mail" size={13} /> Remind {holder}
            </button>
          </div>
        )}
      </Card>

      <Card span="c5" icon="file" tone="mut" title="What it would cost" subtitle="an estimate, not a quotation">
        <div className="kv"><span>Quantity</span><b>{num(document.quantity)} {document.unit}</b></div>
        <div className="kv"><span>Rate used</span><b>{document.rate ? inr(document.rate) : 'not known'}</b></div>
        <div className="kv"><span>Estimated value</span><b>{inr(document.total)}</b></div>
        <div className="kv"><span>Usual vendor</span><b>{document.supplierName}</b></div>
        <div className="kv"><span>Needed by</span><b>{document.deliveryDate || 'not set'}</b></div>

        <SimulatedNote>
          A requisition does not commit to a vendor or a price. The rate is what this
          material last cost, so the value is an estimate used to decide who has to approve
          it — what it actually costs is settled when an order is raised.
        </SimulatedNote>
      </Card>

      {mayDecide && (
        <div className="footerbar">
          <span className="muted" style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="shield" size={13} />{' '}
            {forNext ? `Recording the decision of ${document.next.name}` : `Approving as ${APPROVER_NAME}`}
          </span>
          <input
            className="noteinput"
            placeholder="Approval note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy !== null}
          />
          <button className="btn rej" onClick={() => onDecide('reject', note)} disabled={busy !== null} type="button">
            {busy === 'reject' ? 'Saving…' : 'Send back'}
          </button>
          <button className="btn emph" onClick={() => onDecide('approve', note)} disabled={busy !== null} type="button">
            <Icon name="check" size={13} />
            {busy === 'approve'
              ? 'Saving…'
              : forNext
                ? `Record ${document.next.level?.includes('final') ? 'release' : 'approval'} by ${document.next.name}`
                : document.next
                  ? 'Approve and pass on'
                  : 'Approve and release'}
          </button>
        </div>
      )}
    </>
  );
}

// The reminder itself, written here so the screen that knows why it is urgent is the one
// that says so. It goes into the ordinary compose window: the manager reads it and sends
// it, and the address is looked up on the server exactly as for any other mail.
export function reminderDraft(document) {
  const holder = document.approvalState?.holder;
  const priority = document.priority;

  const urgency = priority?.reasons?.length
    ? `Why it matters:\n${priority.reasons.map((r) => `  - ${r}`).join('\n')}\n\n`
    : '';

  return {
    name: holder,
    toName: holder,
    subject: `Reminder: requisition ${document.id} is waiting for your approval`,
    body:
      `Hello ${holder},\n\n` +
      `Requisition ${document.id} has been with you since ${document.approvalState?.signedAt || 'it was passed on'}. ` +
      `It is for ${num(document.quantity)} ${document.unit} of ${document.material} at ${document.plant}, ` +
      `about ${inr(document.total)}.\n\n` +
      urgency +
      `It cannot go any further until you approve it. If something is holding it up, tell me and I will sort it out from this side.\n\n` +
      `Thanks,\n${APPROVER_NAME}\n${USER_PROFILE.role}, ${COMPANY}`
  };
}
