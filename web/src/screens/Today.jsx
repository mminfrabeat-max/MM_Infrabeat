// The Today screen. What a head of department should read first thing in the morning.
//
// The shape is deliberate: one sentence, then three decisions, then the numbers behind
// them. A manager who reads only the first sentence should still know whether to worry.

import { useApi } from '../useApi.js';
import { api } from '../api.js';
import { money, plural } from '../format.js';
import { Card, Tile, Chip, Score, Loading, ErrorPanel, Icon, bandTone } from '../components/ui.jsx';
import { SparkArea, Donut, Meter, toneColour } from '../components/charts.jsx';

// Shapes for the small sparklines on the tiles. These are illustrative only: we do not
// keep a history of past days yet, so they show a plausible direction rather than a
// measured one. Replace with real history when the morning run starts storing it.
const SHAPES = {
  approvals: [5, 6, 6, 8, 7, 9, 7],
  situations: [2, 3, 3, 5, 4, 6, 6],
  stock: [3, 3, 4, 4, 5, 5, 5],
  score: [78, 76, 72, 68, 63, 58, 55],
  flat: [1, 1, 1, 1, 1, 1, 1]
};

export default function Today({ onNavigate }) {
  const today = useApi(api.today);
  const approvals = useApi(api.approvals);
  const stock = useApi(api.stock);
  const situations = useApi(api.situations);
  const suppliers = useApi(api.suppliers);

  if (today.state === 'loading') return <Loading what="today's position" />;
  if (today.state === 'error') return <ErrorPanel message={today.error} onRetry={today.reload} />;

  const { greeting, summary, decisions, headline } = today.data;

  return (
    <>
      <section className="hero">
        <div className="hero-in">
          <div>
            <span className="live">
              <span className="pulse" />
              Checked at 08:02
            </span>
            <h1>{greeting}</h1>
            <p className="lede">{summary}</p>

            <div className="hchips">
              {decisions.map((decision, index) => (
                <button
                  key={decision.title}
                  className={`hchip${decision.urgent ? ' hot' : ''}`}
                  onClick={() => onNavigate(decision.goTo)}
                  type="button"
                >
                  <span className="r">{index + 1}</span>
                  <span>
                    <span className="t">{decision.title}</span>
                    <span className="s">{decision.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="ring">
            <span style={{ color: '#fff' }}>
              <Donut
                fraction={headline.overdueShare}
                colour="#FF8A80"
                size={104}
                label={`${Math.round(headline.overdueShare * 100)}%`}
                sublabel="overdue"
              />
            </span>
            <div>
              <div className="big n">{money(headline.valueOverdue)}</div>
              <div className="cap">
                waiting longer than a day, out of {money(headline.valueHeld)} in the queue
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="tiles">
        <Tile
          icon="doc"
          label="Waiting for approval"
          value={headline.pendingCount}
          tone={headline.overdueCount > 0 ? 'neg' : 'pos'}
          direction={headline.overdueCount > 0 ? 'up' : 'down'}
          footer={
            headline.overdueCount > 0
              ? `${headline.overdueCount} past 24 hours`
              : 'all inside the limit'
          }
          spark={<SparkArea values={SHAPES.approvals} colour={toneColour(headline.overdueCount ? 'neg' : 'pos')} />}
          onClick={() => onNavigate('approvals')}
        />
        <Tile
          icon="chart"
          label="Value waiting"
          value={money(headline.valueHeld)}
          tone="mut"
          footer={`across ${plural(headline.pendingCount, 'document')}`}
          spark={<SparkArea values={SHAPES.approvals} colour={toneColour('pri')} />}
          onClick={() => onNavigate('approvals')}
        />
        <Tile
          icon="alert"
          label="Problems found"
          value={headline.openSituationCount}
          tone="warn"
          direction="up"
          footer={`${headline.autoFixableCount} can be fixed automatically`}
          spark={<SparkArea values={SHAPES.situations} colour={toneColour('warn')} />}
          onClick={() => onNavigate('situations')}
        />
        <Tile
          icon="box"
          label="Below reorder point"
          value={headline.belowReorderCount}
          tone={headline.atRiskCount > 0 ? 'neg' : 'pos'}
          direction="up"
          footer={`${headline.atRiskCount} run out before restock`}
          spark={<SparkArea values={SHAPES.stock} colour={toneColour(headline.atRiskCount ? 'neg' : 'pos')} />}
          onClick={() => onNavigate('stock')}
        />
        <Tile
          icon="truck"
          label="Weakest supplier"
          value={headline.worstSupplierScore ?? '–'}
          unit="/100"
          tone="neg"
          direction="down"
          footer={`${headline.worstSupplierName}, ${headline.worstSupplierTrend}`}
          spark={<SparkArea values={SHAPES.score} colour={toneColour('neg')} />}
          onClick={() => onNavigate('suppliers')}
        />
        <Tile
          icon="spark"
          label="Handled automatically"
          value={headline.autoFixableCount}
          tone="pos"
          footer="waiting for your confirmation"
          spark={<SparkArea values={SHAPES.flat} colour={toneColour('pos')} />}
          onClick={() => onNavigate('activity')}
        />
      </div>

      <div className="grid">
        <Card
          span="c7"
          icon="alert"
          tone="neg"
          title="Problems the system found"
          subtitle="each one with its cause and a suggested fix"
          action={
            <button className="act" onClick={() => onNavigate('situations')} type="button">
              View all
            </button>
          }
          flush
        >
          {situations.state === 'ready' ? (
            situations.data.situations.slice(0, 4).map((s) => (
              <button key={s.id} className="row" onClick={() => onNavigate('situations')} type="button">
                <span className={`ico bg-${s.severity === 'high' ? 'neg' : 'warn'}`}>
                  <Icon name={s.icon} size={15} />
                </span>
                <span style={{ flex: 1 }}>
                  <span className="t1">{s.title}</span>
                  <span className="t2">{s.detail}</span>
                  <span className="t3">
                    <Icon name="wrench" size={12} /> {s.proposedFix}
                  </span>
                </span>
                <span className="rt">
                  <Chip tone={s.canAutoFix ? 'pri' : 'warn'}>
                    {s.canAutoFix ? 'Can be fixed for you' : 'Needs you'}
                  </Chip>
                  <div className="t3" style={{ marginTop: 7 }}>{s.detectedAt}</div>
                </span>
              </button>
            ))
          ) : (
            <div className="rowpad muted">Loading…</div>
          )}
        </Card>

        <Card
          span="c5"
          icon="truck"
          tone="pri"
          title="Supplier reliability"
          subtitle="from each supplier's last ten orders"
          flush
        >
          {suppliers.state === 'ready' ? (
            suppliers.data.suppliers.map((s) => (
              <button key={s.supplierId} className="row" onClick={() => onNavigate('suppliers')} type="button">
                <span style={{ flex: 1 }}>
                  <span className="t1">{s.name}</span>
                  <span className="t2">
                    {s.onTimePercent}% on time, {s.averageDaysLate} days late on average, price{' '}
                    {s.percentOverContract > 0 ? '+' : ''}
                    {s.percentOverContract}%
                  </span>
                  <Meter percent={s.total} colour={toneColour(bandTone(s.band))} />
                </span>
                <span className="rt">
                  <Score value={s.total} band={s.band} />
                  <div className="t3" style={{ marginTop: 3 }}>{s.bandLabel}</div>
                </span>
              </button>
            ))
          ) : (
            <div className="rowpad muted">Loading…</div>
          )}
        </Card>

        <Card
          span="c8"
          icon="doc"
          tone="warn"
          title="Waiting on your decision"
          subtitle="with the reason each one has not moved"
          flush
        >
          {approvals.state === 'ready' ? (
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Supplier</th>
                  <th className="rt">Value</th>
                  <th>Waiting</th>
                  <th>Supplier score</th>
                </tr>
              </thead>
              <tbody>
                {approvals.data.documents
                  .filter((d) => d.status === 'pending')
                  .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
                  .map((d) => (
                    <tr key={d.id} onClick={() => onNavigate('approvals', d.id)} style={{ cursor: 'pointer' }}>
                      <td>
                        <b>{d.id}</b>
                        <div className="sub">{d.material}, {d.plant}</div>
                        <div className="sub">{d.reason}</div>
                      </td>
                      <td>{d.supplierName}</td>
                      <td className="rt n"><b>{money(d.value)}</b></td>
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
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <div className="rowpad muted">Loading…</div>
          )}
        </Card>

        <Card
          span="c4"
          icon="box"
          tone="neg"
          title="What runs out first"
          subtitle="days of cover against the delivery lead time"
        >
          {stock.state === 'ready' ? (
            stock.data.materials.slice(0, 5).map((m) => (
              <div key={`${m.code}-${m.plant}`} style={{ marginBottom: 14 }}>
                <div className="coverline">
                  <span className="covername">{m.name}</span>
                  <span className={`n ${m.willRunOut ? 'neg' : 'pos'}`} style={{ fontWeight: 700 }}>
                    {m.daysOfCover} d
                  </span>
                </div>
                <Meter
                  percent={Math.min(100, (m.daysOfCover / Math.max(m.leadTimeDays, 1)) * 100)}
                  colour={toneColour(m.willRunOut ? 'neg' : 'pos')}
                />
                <div className="sub">
                  {m.plant}, {m.leadTimeDays} day lead time
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Loading…</p>
          )}
        </Card>
      </div>
    </>
  );
}
