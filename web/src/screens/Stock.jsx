// Stock risk: what runs out, and whether ordering today would even arrive in time.
//
// The distinction this screen exists to make: being below the reorder point is a
// planning signal, but cover shorter than the lead time is the one that stops production.
// A manager watching only the first number gets surprised by the second.

import { useApi } from '../useApi.js';
import { api } from '../api.js';
import { number, plural } from '../format.js';
import { Card, Banner, Chip, Loading, ErrorPanel } from '../components/ui.jsx';
import { Meter, toneColour } from '../components/charts.jsx';

export default function Stock() {
  const { state, data, error, reload } = useApi(api.stock);

  if (state === 'loading') return <Loading what="stock levels" />;
  if (state === 'error') return <ErrorPanel message={error} onRetry={reload} />;

  const { materials, atRiskCount } = data;

  return (
    <>
      {atRiskCount > 0 ? (
        <Banner kind="err" icon="alert">
          <b>{plural(atRiskCount, 'material')} will run out before a delivery could arrive.</b>{' '}
          Cover is shorter than the supplier's lead time, so an order raised today is
          already too late. Below the reorder point is a warning; this is the one that
          stops production.
        </Banner>
      ) : (
        <Banner kind="ok" icon="check">
          Every material has more cover than its delivery lead time.
        </Banner>
      )}

      <Card span="c12" flush icon="box" tone={atRiskCount > 0 ? 'neg' : 'pos'} title="Stock against lead time" subtitle="most urgent first">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Plant</th>
              <th className="rt">In stock</th>
              <th className="rt">Safety level</th>
              <th className="rt">Reorder at</th>
              <th className="rt">On order</th>
              <th className="rt">Used per day</th>
              <th>Cover</th>
              <th className="rt">Lead time</th>
              <th>Suggested</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={`${m.code}-${m.plant}`}>
                <td>
                  <b>{m.name}</b>
                  <div className="sub">{m.code}, usually from {m.supplierName}</div>
                </td>
                <td>{m.plant}</td>
                <td className={`rt n ${m.belowReorderPoint ? 'warn' : ''}`}>
                  {number(m.onHand)} {m.unit}
                </td>
                <td className="rt n">{number(m.safetyStock)}</td>
                <td className="rt n">{number(m.reorderPoint)}</td>
                <td className="rt n">{m.openOrderQuantity ? number(m.openOrderQuantity) : '–'}</td>
                <td className="rt n">{number(m.dailyUsage)}</td>
                <td className="covercell">
                  <Chip tone={m.willRunOut ? 'neg' : m.belowReorderPoint ? 'warn' : 'pos'}>
                    {m.daysOfCover} days
                  </Chip>
                  <Meter
                    percent={Math.min(100, (m.daysOfCover / Math.max(m.leadTimeDays, 1)) * 100)}
                    colour={toneColour(m.willRunOut ? 'neg' : m.belowReorderPoint ? 'warn' : 'pos')}
                  />
                  {m.openOrderQuantity > 0 && (
                    <div className="sub">{m.daysOfCoverWithoutOrders} d if that delivery slips</div>
                  )}
                </td>
                <td className="rt n">{m.leadTimeDays} d</td>
                <td>
                  {m.needsOrderNow ? (
                    <span className="suggestcell">
                      Order {number(m.suggestedOrderQuantity)} {m.unit}
                    </span>
                  ) : (
                    <span className="sub">no action</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="footnote">
        Cover is what is in stock plus what is already on order, divided by average daily
        use. The suggested quantity brings stock back to the reorder point and covers
        consumption while the delivery is in transit. Raising an order from this screen
        arrives in milestone 5.
      </p>
    </>
  );
}
