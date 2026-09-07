// Vendor standing, worst first.
//
// The screen explains its own score rather than presenting a number from nowhere. A buyer
// who cannot see how a score was reached will not trust it, and rightly so. So the
// arithmetic is on the card: SAP's own figure, minus what we took off and why.

import { rupees, signed, plural, bandTone } from '../format.js';
import { Card, Banner, Score, Metric, SimulatedNote } from '../components/ui.jsx';
import { VendorCharts } from '../components/charts.jsx';

export default function Vendors({ data, plant }) {
  // Vendors are not tied to a plant, so the plant selector does not filter this screen.
  // Instead we count how many documents at the chosen plant are waiting with each of them,
  // which is the number that makes the score worth acting on.
  const openWith = (supplierId) =>
    data.documents.filter(
      (d) =>
        d.supplierId === supplierId &&
        d.status === 'pending' &&
        (plant === 'all' || d.plant === plant)
    ).length;

  const vendors = [...data.suppliers].sort((a, b) => a.total - b.total);

  return (
    <>
      <Banner icon="truck">
        The score starts from SAP&rsquo;s own vendor evaluation and is then adjusted for
        direction, because a vendor who used to be good and is slipping matters more than the
        average shows. Points come off for getting later and for charging above contract.
      </Banner>

      <SimulatedNote>
        Delivery and quality history on this screen is demonstration data, not live figures.
      </SimulatedNote>

      <div className="grid">
        {vendors.map((v) => (
          <Card
            key={v.supplierId}
            span="c6"
            icon="truck"
            tone={bandTone(v.band)}
            title={v.name}
            subtitle={`${v.supplierId}, ${v.category}, ${v.city}`}
            action={
              <span className="rt" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                {v.scored ? (
                  <>
                    <Score value={v.total} tone={bandTone(v.band)} />
                    <div className="cs">{v.bandLabel}</div>
                  </>
                ) : (
                  <span className="muted">Not scored</span>
                )}
              </span>
            }
          >
            {v.scored ? (
              <>
                <div className="metrics" style={{ marginBottom: 13 }}>
                  <Metric
                    label="On time"
                    value={`${v.onTimePercent}%`}
                    note={`${v.averageDaysLate} days late on average`}
                    tone={v.onTimePercent >= 80 ? 'pos' : v.onTimePercent >= 50 ? 'warn' : 'neg'}
                  />
                  <Metric
                    label="Quality"
                    value={`${v.averageQuality}%`}
                    note="accepted when it arrives"
                    tone={v.averageQuality >= 98 ? 'pos' : 'warn'}
                  />
                  <Metric
                    label="Rate"
                    value={signed(v.percentOverContract)}
                    note={`against ${rupees(v.contractRate)} per ${v.unit}`}
                    tone={v.percentOverContract > 2 ? 'neg' : v.percentOverContract > 0 ? 'warn' : 'pos'}
                  />
                </div>

                <VendorCharts vendor={v} />

                <div style={{ marginTop: 12, fontSize: '12.6px', color: 'var(--ink-3)' }}>
                  SAP score {v.sapScore}
                  {v.penalty > 0
                    ? `, less ${v.penalty} for ${v.trend === 'getting worse' ? 'slipping deliveries' : 'rate above contract'}, giving ${v.total}.`
                    : `, nothing taken off.`}{' '}
                  GST {v.gst}{v.iec ? `, ${v.iec}` : ''}. Trend is {v.trend}.{' '}
                  {plural(openWith(v.supplierId), 'document')} waiting with them
                  {plant === 'all' ? '' : ` at ${plant}`}.
                </div>
              </>
            ) : (
              <p className="muted">{v.reasonNotScored}. Nothing to judge them on yet.</p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
