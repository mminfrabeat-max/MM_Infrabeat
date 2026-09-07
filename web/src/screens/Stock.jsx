// Stock risk, ordered by how urgent each material actually is.
//
// The idea this screen exists to carry: a material can sit above its reorder point and
// still be short, because the reorder point never knew that three departments between them
// would want 2,520 tonnes this month. Demand comes first, the master data second.

import { inr, num, plural, bandTone } from '../format.js';
import { byPlant, shortMaterials } from '../selectors.js';
import { Card, Banner, Chip } from '../components/ui.jsx';
import { Meter, toneColour } from '../components/charts.jsx';

export default function Stock({ data, plant, canDecide, onRaiseRequest, busyCode }) {
  const rows = byPlant(data.materials, plant);
  const short = shortMaterials(data.materials, plant);

  return (
    <>
      {short.length > 0 ? (
        <Banner kind="err" icon="box">
          <b>{plural(short.length, 'material')} cannot cover what the plants have asked for.</b>{' '}
          The list is ordered by how urgent it is: how much is short, how soon it is needed,
          how long a new load takes, and whether the kiln runs on it.
        </Banner>
      ) : (
        <Banner kind="ok" icon="check">
          Every material covers what the plants have asked for.
        </Banner>
      )}

      <Card span="c12" flush icon="box" tone={short.length ? 'neg' : 'pos'} title="Materials" subtitle="most urgent first">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Material</th>
              <th>Plant</th>
              <th className="rt">In stock</th>
              <th className="rt">On order</th>
              <th className="rt">Departments need</th>
              <th className="rt">Short by</th>
              <th>Needed from</th>
              <th>Stock lasts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={`${m.code}-${m.plant}`}>
                <td><span className={`prio bg-${bandTone(m.band)}`}>{i + 1}</span></td>
                <td>
                  <b>{m.name}</b>
                  <div className="sub">
                    {m.code}, from {m.supplierName}
                    {m.kiln && <> <Chip tone="neg">kiln runs on this</Chip></>}
                  </div>
                  <div className="dem">
                    {m.needs.map((n) => (
                      <span key={n.dept}>
                        {n.dept} <b>{num(n.quantity)}</b> by {n.by}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{m.plant}</td>
                <td className="rt n">{num(m.onHand)} {m.unit}</td>
                <td className="rt n">{m.openOrderQuantity ? num(m.openOrderQuantity) : '–'}</td>
                <td className="rt n">
                  <b>{num(m.totalNeeded)}</b>
                  <div className="sub">{plural(m.needs.length, 'department')}</div>
                </td>
                <td className="rt n">
                  {m.shortBy > 0 ? <Chip tone="neg">{num(m.shortBy)}</Chip> : <Chip tone="pos">nil</Chip>}
                </td>
                <td className="sub">{m.neededFrom || '–'}</td>
                <td>
                  <Chip tone={m.runsOutFirst ? 'neg' : 'pos'}>{m.daysOfCover} days</Chip>
                  <Meter
                    percent={Math.min(100, (m.daysOfCover / Math.max(m.leadTimeDays, 1)) * 100)}
                    colour={toneColour(m.runsOutFirst ? 'neg' : 'pos')}
                  />
                  <div className="sub">new load takes {m.leadTimeDays} days</div>
                </td>
                <td className="rt">
                  {m.shortBy > 0 || m.runsOutFirst ? (
                    <button
                      className="btn sm emph"
                      onClick={() => onRaiseRequest(m)}
                      disabled={!canDecide || busyCode === m.code}
                      type="button"
                    >
                      {busyCode === m.code ? 'Raising…' : 'Raise request'}
                    </button>
                  ) : (
                    <span className="sub">nothing needed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="footnote">
        Priority is worked out from four things: how much short we are against what departments
        asked for, how many days of stock are left, how long a new load takes to arrive, and
        whether the kiln depends on the material. Change the plant at the top to see one plant only.
      </p>
    </>
  );
}
