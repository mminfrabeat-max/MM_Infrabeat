// Vendor standing, worst first.
//
// The screen explains its own score rather than presenting a number from nowhere. A buyer
// who cannot see how a score was reached will not trust it, and rightly so. So the
// arithmetic is on the page: SAP's own figure, minus what we took off and why.
//
// One vendor at a time, rather than all nine at once. Nine vendors each carrying four
// figures and three charts is nine screens of scrolling, and the question this screen
// exists to answer - which of these is the problem - is a comparison, which nobody can
// make while scrolling. So the list is a single column to run an eye down, scored and
// ordered, and whichever one is picked opens beside it in full.
//
// The last card is what makes the score worth having. A vendor who is slipping is a fact.
// A vendor who is slipping while holding a crore of yours awaiting approval is a decision,
// and those documents are one click from here.

import { useState } from 'react';
import { inr, rupees, signed, plural, bandTone } from '../format.js';
import { Card, Banner, Score, Metric, Chip, Icon, TermRow, SimulatedNote } from '../components/ui.jsx';
import { VendorCharts, Meter, toneColour } from '../components/charts.jsx';
import { StatusChip } from './Approvals.jsx';

// The soft background matching a tone, for the panel that explains the score. The chip
// colours are already spoken for; this is the same hue at a weight a paragraph can sit on.
function softFor(tone) {
  if (tone === 'neg') return 'var(--neg-soft)';
  if (tone === 'warn') return 'var(--warn-soft)';
  if (tone === 'pos') return 'var(--pos-soft)';
  return 'var(--primary-soft)';
}

export default function Vendors({ data, plant, onOpenDocument }) {
  // Unscored vendors sort last rather than first. They are not good and not bad; they have
  // no record yet, and the top of a worst-first list would say otherwise.
  const vendors = [...data.suppliers].sort(
    (a, b) => (a.scored ? a.total : 101) - (b.scored ? b.total : 101)
  );

  const [picked, setPicked] = useState(vendors.length ? vendors[0].supplierId : null);
  const vendor = vendors.find((v) => v.supplierId === picked) || vendors[0];

  if (!vendor) {
    return <Banner icon="truck">No vendors are set up yet.</Banner>;
  }

  // A vendor is not tied to a plant, so the list is never filtered. What IS about a place
  // is the work open with them, so the plant selector narrows that, and the card says so.
  const atPlant = (row) => plant === 'all' || row.plant === plant;
  const documents = data.documents.filter((d) => d.supplierId === vendor.supplierId && atPlant(d));
  const contracts = data.contracts.filter((c) => c.supplierName === vendor.name && atPlant(c));
  const waiting = documents.filter((d) => d.status === 'pending');

  const tone = vendor.scored ? bandTone(vendor.band) : 'pri';
  const where = plant === 'all' ? 'across all plants' : `at ${plant}`;

  // How much is sitting with each vendor, for the list itself. The count belongs beside the
  // score because the two together are the point: a poor score with nothing open is a note
  // for later, a poor score with three orders open is today.
  const openCount = (supplierId) =>
    data.documents.filter((d) => d.supplierId === supplierId && d.status === 'pending' && atPlant(d))
      .length;

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
        <Card span="c4" icon="truck" title="Vendors" subtitle="worst standing first" flush>
          {vendors.map((v) => {
            const open = openCount(v.supplierId);
            return (
              <button
                key={v.supplierId}
                type="button"
                className={`row pickrow${v.supplierId === vendor.supplierId ? ' on' : ''}`}
                onClick={() => setPicked(v.supplierId)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="t1">{v.name}</span>
                  <span className="t2">
                    {v.category}, {v.city}
                  </span>
                  {v.scored && <Meter percent={v.total} colour={toneColour(bandTone(v.band))} />}
                  {open > 0 && <span className="t3">{plural(open, 'document')} waiting with them</span>}
                </span>
                <span className="rt">
                  {v.scored ? (
                    <>
                      <Score value={v.total} tone={bandTone(v.band)} />
                      <div className="t3" style={{ marginTop: 3 }}>
                        {v.bandLabel}
                      </div>
                    </>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      not scored
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </Card>

        <div className="c8" style={{ display: 'flex', flexDirection: 'column', gap: 13, minWidth: 0 }}>
          <Card
            icon="truck"
            tone={tone}
            title={vendor.name}
            subtitle={`${vendor.supplierId} · ${vendor.category} · ${vendor.city}`}
            action={
              <span style={{ marginLeft: 'auto' }}>
                {vendor.scored ? (
                  <Score value={vendor.total} tone={tone} />
                ) : (
                  <Chip tone="mut">Not scored</Chip>
                )}
              </span>
            }
          >
            {vendor.scored ? (
              <>
                <div className="metrics">
                  <Metric
                    label="On time"
                    value={`${vendor.onTimePercent}%`}
                    note={`of ${plural(vendor.orderCount, 'order')}`}
                    tone={vendor.onTimePercent >= 80 ? 'pos' : vendor.onTimePercent >= 50 ? 'warn' : 'neg'}
                  />
                  <Metric
                    label="Days late, average"
                    value={vendor.averageDaysLate}
                    note={`${vendor.earlierDaysLate} before, ${vendor.recentDaysLate} now`}
                    tone={vendor.trend === 'getting worse' ? 'neg' : 'pos'}
                  />
                  <Metric
                    label="Quality accepted"
                    value={`${vendor.averageQuality}%`}
                    note="average across loads"
                    tone={vendor.averageQuality >= 98 ? 'pos' : 'warn'}
                  />
                  <Metric
                    label="Rate against contract"
                    value={signed(vendor.percentOverContract)}
                    note={`${rupees(vendor.latestRate)} per ${vendor.unit}`}
                    tone={
                      vendor.percentOverContract > 2
                        ? 'neg'
                        : vendor.percentOverContract > 0
                          ? 'warn'
                          : 'pos'
                    }
                  />
                </div>

                {/* The arithmetic, in a sentence. Without it the number is an opinion with a
                    decimal point, and nobody argues with it or acts on it. */}
                <div className="reco" style={{ background: softFor(tone) }}>
                  <span style={{ flex: 'none', display: 'grid', marginTop: 2 }}>
                    <Icon name="spark" size={15} />
                  </span>
                  <div>
                    SAP&rsquo;s own score is <b>{vendor.sapScore}</b>.{' '}
                    {vendor.penalty > 0 ? (
                      <>
                        {vendor.penalty} points come off for the delivery trend ({vendor.trend}) and
                        the rate against contract, which leaves <b>{vendor.total} out of 100</b>.
                      </>
                    ) : (
                      <>
                        Nothing comes off, because deliveries are {vendor.trend} and the rate is at
                        or below contract, so they stay at <b>{vendor.total} out of 100</b>.
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <Banner kind="warn" icon="clock">
                <b>Not scored yet.</b> {vendor.reasonNotScored}. SAP&rsquo;s own score is{' '}
                {vendor.sapScore}, but there is nothing of ours to judge them on.
              </Banner>
            )}

            <div className="terms" style={{ marginTop: 14 }}>
              <div>
                <TermRow label="GST number" value={vendor.gst} />
                {vendor.iec && <TermRow label="Import code" value={vendor.iec} />}
                <TermRow label="City" value={vendor.city} />
              </div>
              <div>
                <TermRow
                  label="Contract rate"
                  value={`${rupees(vendor.contractRate)} per ${vendor.unit}`}
                />
                <TermRow label="Trend" value={vendor.scored ? vendor.trend : 'not known yet'} />
                <TermRow label="Standing" value={vendor.scored ? vendor.bandLabel : 'not scored'} />
              </div>
            </div>
          </Card>

          {vendor.scored && (
            <Card
              icon="chart"
              tone={tone}
              title="Their last ten orders"
              subtitle="delivery, quality and rate, oldest on the left"
            >
              <VendorCharts vendor={vendor} />
            </Card>
          )}

          {/* What the score is actually about. Everything above is history; this is the money
              in front of you now, and every order row opens. */}
          <Card
            icon="doc"
            tone={waiting.length ? 'warn' : 'pri'}
            title="What is open with them"
            subtitle={`${plural(documents.length, 'document')}, ${plural(
              contracts.length,
              'contract'
            )} ${where}`}
            flush
          >
            {documents.map((d) => (
              <button
                key={d.id}
                type="button"
                className="row pickrow"
                onClick={() => onOpenDocument(d.id)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="t1">
                    {d.kind} {d.id}, {d.material}
                  </span>
                  <span className="t2">
                    {d.plant} plant, due {d.deliveryDate}, rate {signed(d.percentOverContract)} against
                    contract
                  </span>
                </span>
                <span className="rt">
                  <b className="n">{inr(d.total)}</b>
                  <div style={{ marginTop: 4 }}>
                    <StatusChip status={d.status} document={d} />
                  </div>
                </span>
              </button>
            ))}

            {contracts.map((c) => (
              <div key={c.id} className="row">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="t1">
                    Contract {c.id}, {c.covers}
                  </span>
                  <span className="t2">
                    {c.plant}, {c.percentUsed}% of {inr(c.target)} used, valid to {c.validTo}
                  </span>
                  <Meter percent={c.percentUsed} colour={toneColour(bandTone(c.band))} />
                </span>
                <span className="rt">
                  <Chip tone={bandTone(c.band)}>{c.flag}</Chip>
                </span>
              </div>
            ))}

            {documents.length + contracts.length === 0 && (
              <p className="muted rowpad">
                Nothing open with {vendor.name} {where}.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
