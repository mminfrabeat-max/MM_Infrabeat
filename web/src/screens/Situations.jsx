// Problems the system found, each with its cause and a suggested fix.
//
// The distinction worth holding onto: a symptom is "this approval is stuck", a cause is
// "the approver is away and nobody was named to stand in". Only the second one can be
// fixed. Every card here shows the cause, not just the symptom.

import { useApi } from '../useApi.js';
import { api } from '../api.js';
import { Banner, Chip, Loading, ErrorPanel, SimulatedNote, Icon } from '../components/ui.jsx';

export default function Situations() {
  const { state, data, error, reload } = useApi(api.situations);

  if (state === 'loading') return <Loading what="the problem list" />;
  if (state === 'error') return <ErrorPanel message={error} onRetry={reload} />;

  const situations = data.situations;

  return (
    <>
      <Banner icon="spark">
        Each of these names the cause rather than the symptom. Where the cause is known
        and the fix can be undone, the system can apply it once you confirm. Where it
        cannot, you get the evidence and make the call yourself.
      </Banner>

      {data.simulated && (
        <SimulatedNote>
          Everything on this screen is demonstration data. Producing it for real needs
          approval workflow and change history that the practice system does not provide.
        </SimulatedNote>
      )}

      <div className="grid">
        {situations.map((s) => (
          <section key={s.id} className="card c6">
            <div className="chd">
              <span className={`ico bg-${s.severity === 'high' ? 'neg' : 'warn'}`}>
                <Icon name={s.icon} />
              </span>
              <div>
                <h2>{s.title}</h2>
                <div className="cs">
                  {s.category}, about {s.relatedTo}, found at {s.detectedAt}
                </div>
              </div>
              <span style={{ marginLeft: 'auto' }}>
                <Chip tone={s.canAutoFix ? 'pri' : 'warn'}>
                  {s.canAutoFix ? 'Can be fixed for you' : 'Needs you'}
                </Chip>
              </span>
            </div>

            <div className="cbd">
              <p className="sitdetail">{s.detail}</p>
              <dl className="kv">
                <dt>Cause</dt>
                <dd>{s.cause}</dd>
                <dt>Suggested fix</dt>
                <dd>{s.proposedFix}</dd>
              </dl>
              <div className="sitactions">
                <button className="btn emph" disabled type="button">
                  {s.canAutoFix ? 'Apply the fix' : 'Mark as handled'}
                </button>
                <button className="btn q" disabled type="button">Dismiss for today</button>
                <span className="muted" style={{ fontSize: '12.2px' }}>
                  Acting on these arrives in milestone 5
                </span>
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
