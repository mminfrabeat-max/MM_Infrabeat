// Everything already in motion: ordered and not received, asked for and not ordered, and
// how the contracts are being used.
//
// None of these generate an alert anywhere in SAP. A contract can expire unused and nobody
// is told. That is exactly why they belong on a dashboard someone reads every morning.

import { inr, num, plural, bandTone } from '../format.js';
import { byPlant, sumValues, contractsToWatch } from '../selectors.js';
import { Card, Banner, Chip, Tile } from '../components/ui.jsx';
import { SparkArea, Meter, toneColour } from '../components/charts.jsx';

export default function Commitments({ data, plant }) {
  const openOrders = byPlant(data.openOrders, plant);
  const openRequests = byPlant(data.openRequests, plant);
  const contracts = byPlant(data.contracts, plant);
  const flagged = contractsToWatch(data.contracts, plant);

  const agreed = contracts.reduce((sum, c) => sum + c.target, 0);
  const remaining = contracts.reduce((sum, c) => sum + c.remaining, 0);

  return (
    <>
      <Banner icon="file">
        Everything already in motion: what has been ordered and not received, what has been
        asked for and not ordered, and how the contracts are being used.
      </Banner>

      <div className="tiles">
        <Tile
          icon="truck"
          label="Ordered, not received"
          value={openOrders.length}
          sub={inr(sumValues(openOrders))}
          tone="warn"
          footer={`${openOrders.filter((o) => o.receivedPercent === 0).length} with nothing delivered`}
          spark={<SparkArea values={[6, 6, 5, 6, 6, 7, 6]} colour={toneColour('warn')} />}
        />
        <Tile
          icon="file"
          label="Asked for, not ordered"
          value={openRequests.length}
          sub={inr(sumValues(openRequests))}
          tone="warn"
          footer={`${openRequests.filter((r) => r.ageDays > 5).length} older than 5 days`}
          spark={<SparkArea values={[4, 4, 5, 5, 5, 5, 5]} colour={toneColour('warn')} />}
        />
        <Tile
          icon="doc"
          label="Contracts running"
          value={contracts.length}
          sub={`${inr(agreed)} agreed`}
          tone="mut"
          footer={`${inr(remaining)} still to use`}
          spark={<SparkArea values={[5, 5, 5, 5, 5, 5, 5]} colour={toneColour('pri')} />}
        />
        <Tile
          icon="alert"
          label="Contracts to act on"
          value={flagged.length}
          sub="unused or expiring"
          tone={flagged.length ? 'neg' : 'pos'}
          footer="see the list below"
          spark={<SparkArea values={[1, 1, 2, 2, 2, 3, 3]} colour={toneColour(flagged.length ? 'neg' : 'pos')} />}
        />
      </div>

      <div className="grid">
        <Card
          span="c12"
          icon="doc"
          tone={flagged.length ? 'neg' : 'pos'}
          title="Contracts"
          subtitle="how much has been agreed, how much used, and when it runs out"
          flush
        >
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Vendor</th>
                <th>Covers</th>
                <th className="rt">Agreed value</th>
                <th className="rt">Used</th>
                <th className="rt">Left</th>
                <th>Valid until</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.id}</b><div className="sub">{c.plant}</div></td>
                  <td>{c.supplierName}</td>
                  <td className="sub">{c.covers}</td>
                  <td className="rt n">{inr(c.target)}</td>
                  <td className="rt n">
                    {inr(c.used)}
                    <div className="sub">{c.percentUsed} percent</div>
                    <Meter percent={c.percentUsed} colour={toneColour(bandTone(c.band))} />
                  </td>
                  <td className="rt n">{inr(c.remaining)}</td>
                  <td>{c.validTo}<div className="sub">{c.daysLeft} days left</div></td>
                  <td>
                    <Chip tone={bandTone(c.band)}>{c.flag}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card span="c7" icon="truck" tone="warn" title="Ordered but not received" subtitle="money committed, goods not in" flush>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Vendor</th>
                <th className="rt">Value</th>
                <th>Due</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {openOrders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <b>{o.id}</b>
                    <div className="sub">{o.material}, {o.plant}</div>
                    <div className="sub">{o.note}</div>
                  </td>
                  <td>{o.supplierName}</td>
                  <td className="rt n">{inr(o.value)}</td>
                  <td className="sub">{o.due}</td>
                  <td>
                    <Chip tone={o.receivedPercent === 100 ? 'pos' : o.receivedPercent > 0 ? 'warn' : 'neg'}>
                      {o.receivedPercent} percent
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card span="c5" icon="file" tone="warn" title="Asked for but not ordered" subtitle="requests sitting with buyers" flush>
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th className="rt">Value</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {openRequests
                .slice()
                .sort((a, b) => b.ageDays - a.ageDays)
                .map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.id}</b>
                      <div className="sub">{r.dept}, {r.plant}</div>
                      <div className="sub">{r.note}</div>
                    </td>
                    <td className="rt n">{inr(r.value)}</td>
                    <td><Chip tone={r.ageDays > 5 ? 'neg' : 'mut'}>{r.ageDays} d</Chip></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
