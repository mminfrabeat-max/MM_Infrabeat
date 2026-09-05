// What ran this morning, and how any claimed saving is worked out.
//
// The second card is the important one. Any dashboard can claim it saved somebody time.
// Showing the assumption behind every number lets a customer replace our guesses with
// their own figures, which is the only way the claim survives contact with a finance team.

import { useApi } from '../useApi.js';
import { api } from '../api.js';
import { plural } from '../format.js';
import { Card, Banner, Loading, ErrorPanel, SimulatedNote } from '../components/ui.jsx';

export default function Activity() {
  const { state, data, error, reload } = useApi(api.agentActivity);

  if (state === 'loading') return <Loading what="this morning's run" />;
  if (state === 'error') return <ErrorPanel message={error} onRetry={reload} />;

  const { run } = data;

  return (
    <>
      <Banner icon="spark">
        A scheduled check runs each weekday morning, works out what changed overnight and
        sends the head of department a short digest. This screen shows what it did.
      </Banner>

      {data.simulated && (
        <SimulatedNote>
          The scheduled run is not built yet. This describes what it would do, so the
          screen can be reviewed before the job is written.
        </SimulatedNote>
      )}

      <div className="grid">
        <Card
          span="c6"
          icon="spark"
          tone="pri"
          title="This morning's run"
          subtitle={`${plural(run.steps.length, 'step')}, finished at ${run.completedAt}`}
        >
          <div className="tl">
            {run.steps.map((step) => (
              <div key={step.title} className="tli ok">
                <div className="tt">{step.title}</div>
                <div className="ts">{step.detail}</div>
                <div className="tm n">{step.at}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          span="c6"
          icon="eye"
          tone="warn"
          title="How each saving is counted"
          subtitle="so a customer can swap our assumptions for theirs"
          flush
        >
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th className="rt">Minutes</th>
                <th>Where that number comes from</th>
              </tr>
            </thead>
            <tbody>
              {run.savingsBasis.map((row) => (
                <tr key={row.action}>
                  <td>{row.action}</td>
                  <td className="rt n"><b>{row.minutes}</b></td>
                  <td className="muted">{row.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <p className="footnote">
        These are estimates of effort avoided, not measured savings. Counting real ones
        needs the actions themselves, which arrive in milestone 5.
      </p>
    </>
  );
}
