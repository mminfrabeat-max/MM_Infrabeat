// The Overview. What a head of department reads first thing in the morning.
//
// The shape is deliberate: one sentence, then the three things that need a decision, then
// the numbers behind them. Someone who reads only the first sentence should still know
// whether to worry.

import { inr, plural, firstName, greeting, bandTone } from '../format.js';
import { APPROVER_NAME } from '../brand.js';
import { Card, Tile, Chip, Score, Icon } from '../components/ui.jsx';
import { SparkArea, Donut, Meter, toneColour } from '../components/charts.jsx';
import {
  byPlant, pendingDocuments, overdueDocuments, sumTotals, sumValues,
  shortMaterials, contractsToWatch, openSituations
} from '../selectors.js';

// Shapes for the small sparklines. These are illustrative only: we do not keep a history
// of past days yet, so they show a plausible direction rather than a measured one.
const SHAPES = {
  approvals: [3, 4, 4, 5, 4, 6, 5],
  stock: [1, 1, 2, 2, 2, 3, 2],
  orders: [5, 5, 6, 6, 6, 7, 6],
  requests: [3, 4, 4, 5, 5, 5, 5],
  contracts: [1, 1, 2, 2, 2, 3, 3],
  problems: [2, 3, 3, 4, 4, 5, 5]
};

export default function Overview({ data, plant, onNavigate, onOpenDocument, onOpenLog, savedMinutes, actionCount }) {
  const pending = pendingDocuments(data.documents, plant);
  const overdue = overdueDocuments(data.documents, plant);
  const short = shortMaterials(data.materials, plant);
  const openOrders = byPlant(data.openOrders, plant);
  const openRequests = byPlant(data.openRequests, plant);
  const flagged = contractsToWatch(data.contracts, plant);
  const problems = openSituations(data.situations, plant);

  const waitingValue = sumTotals(pending);
  const worstMaterial = short[0];
  const neverUsed = flagged.find((c) => c.flag === 'never used');
  const worst = data.worstSupplier;

  return (
    <>
      <section className="hero">
        <div className="hero-in">
          <div>
            <span className="live">
              <span className="pulse" />
              Checked at 8:00 this morning
            </span>

            <h1>
              {greeting()}, {firstName(APPROVER_NAME)}.{' '}
              {pending.length
                ? `${plural(pending.length, 'order')} waiting for you`
                : 'Nothing is waiting for you'}
              {plant === 'all' ? '' : ` at ${plant}`}
            </h1>

            <p className="lede">
              {pending.length > 0 && `${inr(waitingValue)} is waiting for you to approve. `}
              {short.length > 0
                ? `${plural(short.length, 'material')} will run short. ${worstMaterial.name} at ${worstMaterial.plant} runs out first. `
                : 'Every plant has enough stock. '}
              {flagged.length > 0
                ? `${flagged.length}${flagged.length === 1 ? ' contract needs' : ' contracts need'} a look` +
                  (neverUsed ? `, one of ${inr(neverUsed.target)} never used.` : '.')
                : 'All contracts are fine.'}
            </p>

            <div className="hchips">
              {pending
                .slice()
                .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
                .slice(0, 3)
                .map((d, i) => (
                  <button
                    key={d.id}
                    className={`hchip${i === 0 ? ' hot' : ''}`}
                    onClick={() => onOpenDocument(d.id)}
                    type="button"
                  >
                    <span className="r">{i + 1}</span>
                    <span>
                      <span className="t">{d.kind} {d.id}, {inr(d.total)}</span>
                      <span className="s">
                        {d.supplierName}, {d.trade.toLowerCase()}, waiting {d.hoursWaiting} h
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          </div>

          <button className="ring saved" onClick={onOpenLog} type="button">
            <span style={{ color: '#fff' }}>
              <Donut
                fraction={Math.min(1, savedMinutes / 90)}
                colour="#4FE0B0"
                size={104}
                label={savedMinutes}
                sublabel="min saved"
              />
            </span>
            <div>
              <div className="big n">{plural(actionCount, 'action')}</div>
              <div className="cap">done from here today instead of in SAP</div>
              <span className="ringcta">See everything you did</span>
            </div>
          </button>
        </div>
      </section>

      <div className="tiles">
        <Tile
          icon="doc"
          label="Waiting for approval"
          value={pending.length}
          sub={inr(waitingValue)}
          tone={overdue.length ? 'neg' : 'pos'}
          footer={`${overdue.length} over a day old`}
          spark={<SparkArea values={SHAPES.approvals} colour={toneColour(overdue.length ? 'neg' : 'pos')} />}
          onClick={() => onNavigate('approvals')}
        />
        <Tile
          icon="box"
          label="Materials short"
          value={short.length}
          sub={short.length ? `first need by ${short[0].neededFrom}` : 'none'}
          tone={short.length ? 'neg' : 'pos'}
          footer={short.length ? 'less than what plants asked for' : 'all covered'}
          spark={<SparkArea values={SHAPES.stock} colour={toneColour(short.length ? 'neg' : 'pos')} />}
          onClick={() => onNavigate('stock')}
        />
        <Tile
          icon="truck"
          label="Ordered, not received"
          value={openOrders.length}
          sub={inr(sumValues(openOrders))}
          tone="warn"
          footer={`${openOrders.filter((o) => o.receivedPercent < 100).length} still open`}
          spark={<SparkArea values={SHAPES.orders} colour={toneColour('warn')} />}
          onClick={() => onNavigate('open')}
        />
        <Tile
          icon="file"
          label="Requests not yet ordered"
          value={openRequests.length}
          sub={inr(sumValues(openRequests))}
          tone="warn"
          footer="buyers have not converted them"
          spark={<SparkArea values={SHAPES.requests} colour={toneColour('warn')} />}
          onClick={() => onNavigate('open')}
        />
        <Tile
          icon="file"
          label="Contracts to look at"
          value={flagged.length}
          sub="unused or expiring"
          tone={flagged.length ? 'neg' : 'pos'}
          footer={neverUsed ? 'one has never been used' : 'all being used'}
          spark={<SparkArea values={SHAPES.contracts} colour={toneColour(flagged.length ? 'neg' : 'pos')} />}
          onClick={() => onNavigate('open')}
        />
        <Tile
          icon="alert"
          label="Problems found"
          value={problems.length}
          sub="already checked for you"
          tone="warn"
          footer={`${problems.filter((s) => s.canAutoFix).length} I can fix`}
          spark={<SparkArea values={SHAPES.problems} colour={toneColour('warn')} />}
          onClick={() => onNavigate('situations')}
        />
      </div>

      <div className="grid">
        <Card
          span="c7"
          icon="doc"
          tone="warn"
          title="Waiting for your approval"
          subtitle="the header details you need to decide"
          flush
        >
          {pending.length === 0 ? (
            <p className="muted rowpad">Nothing is waiting{plant === 'all' ? '' : ` at ${plant}`}.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Type</th>
                  <th>Vendor</th>
                  <th className="rt">Total value</th>
                  <th>Waiting</th>
                  <th>Approved before by</th>
                </tr>
              </thead>
              <tbody>
                {pending
                  .slice()
                  .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
                  .map((d) => (
                    <tr key={d.id} className="clickrow" onClick={() => onOpenDocument(d.id)}>
                      <td>
                        <b>{d.kind} {d.id}</b>
                        <div className="sub">{d.material}, {d.materialCode}, {d.plant}</div>
                      </td>
                      <td>
                        <Chip tone={d.trade === 'Import' ? 'pri' : 'mut'}>{d.trade}</Chip>
                        <div className="sub">{d.docType.split(',')[0]}</div>
                      </td>
                      <td>{d.supplierName}</td>
                      <td className="rt n"><b>{inr(d.total)}</b></td>
                      <td>
                        <Chip tone={d.hoursWaiting > 48 ? 'neg' : d.hoursWaiting > 24 ? 'warn' : 'mut'}>
                          {d.hoursWaiting} h
                        </Chip>
                      </td>
                      <td className="sub">
                        {d.prev ? (<>{d.prev.name}<br />{d.prev.when}</>) : 'You are the first'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          span="c5"
          icon="box"
          tone={short.length ? 'neg' : 'pos'}
          title="Stock against what plants asked for"
          subtitle="most urgent first"
          flush
        >
          {byPlant(data.materials, plant).slice(0, 5).map((m, i) => (
            <div className="row" key={`${m.code}-${m.plant}`}>
              <span className={`prio bg-${bandTone(m.band)}`}>{i + 1}</span>
              <span style={{ flex: 1 }}>
                <span className="t1">{m.name}, {m.plant}</span>
                <span className="t2">
                  {m.needs.length} departments asked for {m.totalNeeded.toLocaleString('en-IN')} {m.unit},
                  we have {m.available.toLocaleString('en-IN')}
                </span>
                <Meter
                  percent={m.totalNeeded > 0 ? (m.available / m.totalNeeded) * 100 : 100}
                  colour={toneColour(bandTone(m.band))}
                />
              </span>
              <span className="rt">
                {m.shortBy > 0
                  ? <Chip tone="neg">short {m.shortBy.toLocaleString('en-IN')}</Chip>
                  : <Chip tone="pos">covered</Chip>}
                <div className="t3" style={{ marginTop: 6 }}>{m.daysOfCover} days left</div>
              </span>
            </div>
          ))}
        </Card>

        <Card
          span="c12"
          icon="truck"
          tone={worst ? bandTone(worst.band) : 'pri'}
          title="Vendor standing"
          subtitle="SAP's own score, adjusted for how they are trending and what they are charging"
          action={
            <button className="act" onClick={() => onNavigate('suppliers')} type="button">
              View all
            </button>
          }
          flush
        >
          {[...data.suppliers].sort((a, b) => a.total - b.total).map((s) => (
            <button key={s.supplierId} className="row" onClick={() => onNavigate('suppliers')} type="button">
              <span style={{ flex: 1 }}>
                <span className="t1">{s.name}</span>
                <span className="t2">
                  {s.scored
                    ? `${s.onTimePercent}% on time, ${s.averageDaysLate} days late on average, rate ${s.percentOverContract > 0 ? '+' : ''}${s.percentOverContract}% against contract`
                    : s.reasonNotScored}
                </span>
                {s.scored && <Meter percent={s.total} colour={toneColour(bandTone(s.band))} />}
              </span>
              <span className="rt">
                {s.scored ? (
                  <>
                    <Score value={s.total} tone={bandTone(s.band)} />
                    <div className="t3" style={{ marginTop: 3 }}>{s.bandLabel}, {s.trend}</div>
                  </>
                ) : (
                  <span className="muted">not scored</span>
                )}
              </span>
            </button>
          ))}
        </Card>
      </div>
    </>
  );
}
