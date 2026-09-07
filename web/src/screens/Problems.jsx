// Problems found while checking this morning.
//
// The distinction the whole screen rests on: a symptom is "this approval is stuck", a cause
// is "the approver is on leave and nobody was named to stand in". Only the second one can
// be fixed, so every card leads with the cause and names the person to speak to.
//
// "Found by joining" is the honest bit. No single record says any of these things. Each one
// took two or three separate facts placed side by side, and showing which ones is what makes
// the finding checkable rather than magic.

import { mailAddressFor } from '../format.js';
import { APPROVER_NAME, COMPANY } from '../brand.js';
import { byPlant } from '../selectors.js';
import { Card, Banner, Chip, Icon, SimulatedNote } from '../components/ui.jsx';

export default function Problems({ data, plant, canDecide, onFix, onWriteMail, busyId }) {
  const problems = byPlant(data.situations, plant);

  return (
    <>
      <Banner icon="spark">
        Problems found while checking this morning. Where the fix is safe and can be undone,
        I can do it once you say so.
      </Banner>

      <SimulatedNote>
        Everything on this screen is demonstration data. Producing it for real needs approval
        workflow, leave records and cost centre ownership that the practice system does not provide.
      </SimulatedNote>

      <div className="grid">
        {problems.map((s) => {
          const done = s.status !== 'open';
          return (
            <section className="card c6" key={s.id}>
              <div className="chd">
                <span className={`ico bg-${done ? 'pos' : s.severity === 'high' ? 'neg' : 'warn'}`}>
                  <Icon name={done ? 'check' : s.icon} />
                </span>
                <div>
                  <h2>{s.title}</h2>
                  <div className="cs">{s.where || s.relatedTo}</div>
                </div>
                <span style={{ marginLeft: 'auto' }}>
                  <Chip tone={done ? 'pos' : s.canAutoFix ? 'pri' : 'warn'}>
                    {done ? 'Done' : s.canAutoFix ? 'I can fix this' : 'Needs your call'}
                  </Chip>
                </span>
              </div>

              <div className="cbd">
                <p className="sitlede">{s.detail}</p>

                <dl className="kv">
                  <dt>Who is involved</dt>
                  <dd>{s.who}</dd>
                  <dt>Where it is stuck</dt>
                  <dd>{s.stuck}</dd>
                  <dt>Call you need to make</dt>
                  <dd style={{ fontWeight: 650 }}>{s.call}</dd>
                  <dt>Who to speak to</dt>
                  <dd>{s.speakTo}</dd>
                  <dt>Follow up</dt>
                  <dd>{s.followUp}</dd>
                </dl>

                {s.joined?.length > 0 && (
                  <div className="joined">
                    <span className="jl"><Icon name="eye" size={13} /> Found by joining</span>
                    {s.joined.map((j) => (
                      <Chip key={j} tone="mut">{j}</Chip>
                    ))}
                  </div>
                )}

                <div className="sitact">
                  {done ? (
                    <Chip tone="pos" icon="check">Fixed. {s.fix}</Chip>
                  ) : (
                    <>
                      <button
                        className="btn emph"
                        type="button"
                        onClick={() => onFix(s)}
                        disabled={!canDecide || busyId === s.id}
                      >
                        {busyId === s.id ? 'Working…' : s.canAutoFix ? 'Go ahead and fix it' : 'Mark as handled'}
                      </button>
                      <button
                        className="btn q"
                        type="button"
                        onClick={() =>
                          onWriteMail({
                            name: s.speakTo.split(',')[0],
                            to: mailAddressFor(s.speakTo),
                            subject: s.title,
                            body:
                              `Hello ${s.speakTo.split(',')[0]},\n\n${s.detail}\n\n` +
                              `What I need: ${s.call}\n\n` +
                              `Where it is stuck: ${s.stuck}\n\n` +
                              `I will follow up: ${s.followUp}\n\n` +
                              `Thanks,\n${APPROVER_NAME}\nHead of Procurement, ${COMPANY}`
                          })
                        }
                      >
                        <Icon name="mail" size={13} /> Mail {s.speakTo.split(',')[0]}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
