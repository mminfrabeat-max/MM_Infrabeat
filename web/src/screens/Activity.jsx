// What ran this morning, and how any claimed saving is worked out.
//
// The second card is the important one. Any dashboard can claim it saved somebody time.
// Showing the assumption behind every number lets a customer replace our guesses with
// their own figures, which is the only way the claim survives contact with a finance team.

import { useApi } from '../useApi.js';
import { api } from '../api.js';
import { plural, money } from '../format.js';
import { Card, Banner, Chip, Loading, ErrorPanel, SimulatedNote } from '../components/ui.jsx';

export default function Activity() {
  const { state, data, error, reload } = useApi(api.agentActivity);
  const log = useApi(api.actionLog);

  if (state === 'loading') return <Loading what="this morning's run" />;
  if (state === 'error') return <ErrorPanel message={error} onRetry={reload} />;

  const { run } = data;

  return (
    <>
      {log.state === 'ready' && log.data.available && (
        <Card
          span="c12"
          icon="check"
          tone="pos"
          title="Decisions recorded"
          subtitle={`${plural(log.data.entries.length, 'decision')}, newest first, saved in the workbook`}
          flush
        >
          {log.data.entries.length === 0 ? (
            <p className="muted" style={{ padding: '22px 17px' }}>
              Nothing decided yet. Approve or reject something on the Approvals tab and it
              will appear here and in the workbook.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Decision</th>
                  <th>Document</th>
                  <th>Supplier</th>
                  <th className="rt">Value</th>
                  <th>By</th>
                  <th>Note</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {log.data.entries.map((e, i) => (
                  <tr key={`${e.documentId}-${i}`}>
                    <td className="n">{e.at}</td>
                    <td>
                      <Chip tone={e.action === 'approved' ? 'pos' : 'neg'}>{e.action}</Chip>
                    </td>
                    <td className="n"><b>{e.documentId}</b></td>
                    <td>{e.supplierName}</td>
                    <td className="rt n">{money(Number(e.value) || 0)}</td>
                    <td className="muted">{e.decidedBy}</td>
                    <td className="muted">{e.note || '–'}</td>
                    <td>
                      <Chip tone={String(e.emailStatus).startsWith('Sent') ? 'pos' : 'warn'}>
                        {String(e.emailStatus).startsWith('Sent') ? 'sent' : 'not sent'}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

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
