// A dial, for a score out of a hundred.
//
// Drawn rather than installed, like everything else here. It is three arcs and a needle;
// the chart libraries that do this bring three hundred kilobytes and a second set of
// opinions about colour.
//
// The arc is coloured in three, and the boundaries are the real ones - the red section ends
// where "Behind" ends and the green begins where "Steady" begins. That matters more than it
// sounds: a dial whose colours do not line up with the words underneath it is decoration
// that happens to be near a number, and the reader learns to ignore one or the other.
//
// Geometry, once, so the rest reads plainly. Angles are measured the way a protractor does -
// zero at three o'clock, rising anticlockwise - and the dial sweeps 240 degrees from 210
// (lower left, a score of nothing) round the top to -30 (lower right, a hundred).

const CENTRE = 50;
const RADIUS = 38;
const SWEEP = 240;
const START = 210;

// Where the bands change, as scores. The arc is cut at exactly these points.
const BOUNDARIES = [0, 50, 70, 100];
const TONES = ['neg', 'warn', 'pos'];

function pointAt(angle, radius = RADIUS) {
  const radians = (angle * Math.PI) / 180;
  return [CENTRE + radius * Math.cos(radians), CENTRE - radius * Math.sin(radians)];
}

function angleFor(score) {
  const held = Math.max(0, Math.min(100, score));
  return START - (held / 100) * SWEEP;
}

function arcBetween(fromScore, toScore) {
  const [x1, y1] = pointAt(angleFor(fromScore));
  const [x2, y2] = pointAt(angleFor(toScore));
  const large = Math.abs(angleFor(fromScore) - angleFor(toScore)) > 180 ? 1 : 0;
  // Sweep flag 1: clockwise on screen, which is the direction a score increases.
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${RADIUS} ${RADIUS} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function Gauge({ score, tone, size = 96, label }) {
  const needle = angleFor(score);
  const [tipX, tipY] = pointAt(needle, RADIUS - 9);

  return (
    <div className="gauge" style={{ width: size }}>
      <svg viewBox="0 0 100 74" width={size} height={size * 0.74} role="img" aria-label={`Score ${score} out of 100`}>
        {/* The three bands, drawn thick and blunt-ended so they meet cleanly. */}
        {TONES.map((t, i) => (
          <path
            key={t}
            d={arcBetween(BOUNDARIES[i], BOUNDARIES[i + 1])}
            className={`garc ${t}`}
            strokeWidth="11"
            fill="none"
          />
        ))}

        {/* The needle, and the pin it turns on. */}
        <line
          x1={CENTRE}
          y1={CENTRE}
          x2={tipX.toFixed(2)}
          y2={tipY.toFixed(2)}
          className={`gneedle ${tone}`}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <circle cx={CENTRE} cy={CENTRE} r="4.6" className={`gpin ${tone}`} />
      </svg>

      <div className={`gscore ${tone}`}>{score}</div>
      {label && <div className="glabel">{label}</div>}
    </div>
  );
}
