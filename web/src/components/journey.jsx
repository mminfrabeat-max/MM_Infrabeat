// The journey a shipment makes, drawn rather than described.
//
// The card used to be six rows of text: a route, a position, an ETA, a note about what
// happens after the port. All true, and all of it had to be assembled in your head before
// it meant anything. Where is this, and is it moving, are shape questions - a line answers
// them faster than a sentence can.
//
// Two rules keep it honest:
//
//   1. Nothing here is to scale, and nothing pretends to be. The ship sits at the middle of
//      its leg because that is where a label goes, not because it is halfway. The real
//      position is printed underneath, in the words the feed gave us.
//
//   2. A leg is solid once it has started and dashed while it has not. That is the only
//      claim the drawing makes, and it is one we can actually stand behind.

import { Icon } from './ui.jsx';

// Sea, rail, road. The one place the mapping lives, so a new mode is one line.
const MODE = {
  Sea: { icon: 'ship', label: 'by sea' },
  Rail: { icon: 'train', label: 'by rail' },
  Road: { icon: 'truck', label: 'by road' }
};

export function modeIcon(transport) {
  return MODE[transport]?.icon || 'truck';
}

// What carries the goods from the port to the plant.
//
// Nobody records this as a field. The feed writes it into a sentence - "5 days for customs
// and the rail leg" - so that sentence is where it has to be read from. Rail if it says so,
// otherwise a lorry, which is what it is in every other case.
function inlandMode(afterPort) {
  const text = String(afterPort || '').toLowerCase();
  if (text.includes('rail') || text.includes('train')) return 'Rail';
  return 'Road';
}

// --- Putting the position on a map -------------------------------------------

// Pulls coordinates out of the sentence the feed sends.
//
// The position arrives as "21.4 N, 68.9 E, west of Porbandar" - a number, a hemisphere, and
// a landmark for a person to read. There is no latitude field anywhere upstream, so this is
// the only place the numbers exist, and reading them here beats adding two columns that
// would have to be kept in step with the text.
//
// Returns null rather than a guess when the shape does not match. A map centred on the
// wrong ocean is worse than no map.
export function coordinatesFrom(position) {
  const match = String(position || '').match(/(\d+(?:\.\d+)?)\s*([NS])\s*,\s*(\d+(?:\.\d+)?)\s*([EW])/i);
  if (!match) return null;

  const lat = Number(match[1]) * (match[2].toUpperCase() === 'S' ? -1 : 1);
  const lng = Number(match[3]) * (match[4].toUpperCase() === 'W' ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

// The vessel on a real map, the way any parcel tracking page shows a van.
//
// This is an iframe to Google rather than a mapping library, for one reason: it needs no
// key, no package and no build step, and the alternative is 200KB of JavaScript to draw
// tiles we do not own anyway. What it costs is honest to state - the viewer's browser talks
// to Google, and there is nothing to show when there is no internet, which is why the
// caption says so and the offline copy of this dashboard falls back to the text.
export function VesselMap({ vessel }) {
  const at = coordinatesFrom(vessel.position);
  if (!at) return null;

  const q = `${at.lat},${at.lng}`;
  // z=6 is wide enough to show which sea it is in and which coast it is off, which is the
  // question. Closer than that is open water with nothing to place it against.
  const embed = `https://maps.google.com/maps?q=${q}&z=6&output=embed`;
  const full = `https://www.google.com/maps?q=${q}`;

  return (
    <div className="vmap">
      <iframe
        title={`${vessel.name} at ${vessel.position}`}
        src={embed}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="vmapfoot">
        <span>
          <Icon name="ship" size={13} /> {vessel.name} at {at.lat}&deg; {at.lat < 0 ? 'S' : 'N'}, {Math.abs(at.lng)}&deg;{' '}
          {at.lng < 0 ? 'W' : 'E'}, as of {vessel.updated}
        </span>
        <a href={full} target="_blank" rel="noreferrer noopener">
          Open in Google Maps
        </a>
      </div>
    </div>
  );
}

function Node({ icon, name, sub, done }) {
  return (
    <div className="jnode">
      <span className={`jdot ${done ? 'done' : ''}`}>
        <Icon name={icon} size={15} />
      </span>
      <div className="jname">{name}</div>
      {sub && <div className="jsub">{sub}</div>}
    </div>
  );
}

function Leg({ mode, started, sub }) {
  const m = MODE[mode] || MODE.Road;
  return (
    <div className={`jleg ${started ? 'moving' : ''}`}>
      <div className="jtrack">
        <span className="jvehicle">
          <Icon name={m.icon} size={16} />
        </span>
      </div>
      <div className="jsub">{sub}</div>
    </div>
  );
}

// A shipment on the water: origin port, the sea leg, the landing port, the inland leg, the
// plant. The sea leg has started; the inland one has not, because the ship has not docked.
export function SeaJourney({ vessel, plant }) {
  const inland = inlandMode(vessel.afterPort);

  return (
    <div className="journey">
      <Node icon="anchor" name={vessel.from} sub="loaded and sailed" done />
      <Leg mode="Sea" started sub={`at sea · ${vessel.position}`} />
      <Node icon="anchor" name={vessel.to} sub={`ETA ${vessel.eta}`} />
      <Leg mode={inland} sub={vessel.afterPort} />
      <Node icon="factory" name={`${plant} plant`} sub="final delivery" />
    </div>
  );
}

// A domestic order: one leg, one mode, from the vendor to the plant. There is no feed
// behind this one, so it says where the goods are going and stops there.
export function InlandJourney({ transport, from, plant, deliveryDate }) {
  return (
    <div className="journey">
      <Node icon="box" name={from} sub="vendor" done />
      <Leg mode={transport} sub={MODE[transport]?.label || 'in transit'} />
      <Node icon="factory" name={`${plant} plant`} sub={deliveryDate ? `due ${deliveryDate}` : ''} />
    </div>
  );
}
