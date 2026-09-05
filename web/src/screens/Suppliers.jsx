// Supplier reliability, worst first.
//
// The screen explains its own score rather than presenting a number from nowhere. A
// manager who cannot see how a score is built will not trust it, and rightly so.

import { useApi } from '../useApi.js';
import { api } from '../api.js';
import { rupees, signedPercent, plural } from '../format.js';
import { Card, Banner, Score, Loading, ErrorPanel, SimulatedNote, bandTone } from '../components/ui.jsx';
import { SupplierCharts } from '../components/charts.jsx';

export default function Suppliers() {
  const { state, data, error, reload } = useApi(api.suppliers);

  if (state === 'loading') return <Loading what="supplier performance" />;
  if (state === 'error') return <ErrorPanel message={error} onRetry={reload} />;

  return (
    <>
      <Banner icon="chart">
        Each score comes from that supplier's last ten orders: 40 percent delivery,
        35 percent quality, 25 percent price against the agreement, less a penalty when
        recent orders are worse than earlier ones. A delivery counts as on time if it
        arrives within a day of the promised date. The direction matters more than the
        average when the next order is about to be signed.
      </Banner>

      {data.historySimulated && (
        <SimulatedNote>
          Delivery and quality history on this screen is demonstration data, not live figures.
        </SimulatedNote>
      )}

      <div className="grid">
        {data.suppliers.map((s) => (
          <Card
            key={s.supplierId}
            span="c6"
            icon="truck"
            tone={bandTone(s.band)}
            title={s.name}
            subtitle={
              s.scored
                ? `${s.supplierId}, ${s.category}, ten orders to ${s.history[s.history.length - 1].month}`
                : `${s.supplierId}, ${s.category}`
            }
            action={
              <span className="rt" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                {s.scored ? (
                  <>
                    <Score value={s.total} band={s.band} />
                    <div className="cs">{s.bandLabel}</div>
                  </>
                ) : (
                  <span className="muted">Not scored</span>
                )}
              </span>
            }
          >
            {s.scored ? (
              <>
                <div className="metrics" style={{ marginBottom: 13 }}>
                  <Metric
                    label="Delivered on time"
                    value={`${s.onTimePercent}%`}
                    note={`within ${s.onTimeToleranceDays} day of the promised date`}
                    tone={s.onTimePercent >= 80 ? 'pos' : s.onTimePercent >= 50 ? 'warn' : 'neg'}
                  />
                  <Metric
                    label="Quality"
                    value={`${s.averageQuality}%`}
                    note="accepted on delivery"
                    tone={s.averageQuality >= 98 ? 'pos' : 'warn'}
                  />
                  <Metric
                    label="Price"
                    value={signedPercent(s.percentOverContract)}
                    note={`against ${rupees(s.contractRate)} per ${s.unit}`}
                    tone={s.percentOverContract > 2 ? 'neg' : s.percentOverContract > 0 ? 'warn' : 'pos'}
                  />
                </div>

                <SupplierCharts supplier={s} />

                <div className="cardnote">
                  Trend {s.trend}. {plural(s.openDocumentCount, 'document')} waiting for approval with them.
                </div>
              </>
            ) : (
              <p className="muted">{s.reasonNotScored}. Nothing to judge them on yet.</p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

function Metric({ label, value, note, tone }) {
  return (
    <div className="metric">
      <div className="ml">{label}</div>
      <div className={`mv n ${tone}`}>{value}</div>
      <div className="mn">{note}</div>
    </div>
  );
}
