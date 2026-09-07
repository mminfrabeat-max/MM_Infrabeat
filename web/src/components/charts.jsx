// Every chart on the dashboard, written by hand as SVG. No chart library.
//
// This is less scary than it sounds. An SVG chart is arithmetic plus strings: turn each
// data value into an x and a y inside a fixed box, then join them into a path.
//
// The one idea that makes it all work is the viewBox. It says "this drawing uses a grid
// 240 wide and 92 tall". The browser then scales that grid to whatever space the chart
// actually gets, so all the maths below uses round numbers and never touches pixels.
//
// Colours are read from the CSS variables at draw time, so the charts follow the light and
// dark themes without carrying their own palette.

import { Icon } from './ui.jsx';

function round1(n) {
  return Math.round(n * 10) / 10;
}

function readColour(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function toneColour(tone) {
  if (tone === 'neg') return readColour('--neg');
  if (tone === 'warn') return readColour('--warn');
  if (tone === 'pos') return readColour('--pos');
  return readColour('--primary');
}

// Every gradient in an SVG needs an id unique to the page, or two charts sharing an id
// will both use whichever gradient was defined last.
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `grad${idCounter}`;
}

// --- Sparkline ---------------------------------------------------------------
// The small shape behind each tile. Direction only, deliberately without axes or labels:
// it answers "which way is this going" and nothing more.

export function SparkArea({ values, colour, width = 96, height = 40 }) {
  const id = nextId();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - 4 - ((v - min) / range) * (height - 12)
  ]);
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round1(x)} ${round1(y)}`).join(' ');

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity="0.35" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Closing the path back down to the baseline turns the line into a filled area. */}
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={colour} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

// --- Delivery bars -----------------------------------------------------------
// One bar per order, height is how many days late. Bars sit above or below a zero line, so
// an early delivery visibly points the other way.

export function DeliveryBars({ values, lateLimit = 3 }) {
  const width = 240;
  const height = 92;
  const inset = 4;
  const gap = 3;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const slot = (width - inset * 2) / values.length;
  const barWidth = slot - gap;
  const zeroY = height - 14 - ((0 - min) / range) * (height - 26);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="none">
      <line x1="0" y1={round1(zeroY)} x2={width} y2={round1(zeroY)} stroke={readColour('--border-2')} strokeWidth="1" />
      {values.map((value, i) => {
        const y = height - 14 - ((value - min) / range) * (height - 26);
        const top = Math.min(y, zeroY);
        // A zero-day delay would otherwise draw an invisible bar, so give it a minimum.
        const barHeight = Math.max(2.5, Math.abs(zeroY - y));
        const colour =
          value <= 0 ? readColour('--pos') : value > lateLimit ? readColour('--neg') : readColour('--warn');
        return (
          <rect
            key={i}
            x={round1(inset + i * slot)}
            y={round1(top)}
            width={round1(barWidth)}
            height={round1(barHeight)}
            rx="2.5"
            fill={colour}
          />
        );
      })}
      <text x="2" y={height - 2} fontSize="9" fill={readColour('--ink-3')}>10 orders ago</text>
      <text x={width - 2} y={height - 2} textAnchor="end" fontSize="9" fill={readColour('--ink-3')}>latest</text>
    </svg>
  );
}

// --- Line with a filled area --------------------------------------------------
// Quality and price over the last ten orders. The optional reference line is what makes
// the price chart useful: it shows the contract rate, so "above the line" means "costing
// more than agreed" at a glance.

export function TrendLine({ values, colour, reference, referenceLabel = 'contract rate' }) {
  const width = 240;
  const height = 92;
  const id = nextId();
  const count = values.length;

  let max = Math.max(...values);
  let min = Math.min(...values);
  if (reference !== undefined && reference !== null) {
    max = Math.max(max, reference);
    min = Math.min(min, reference);
  }
  // A little breathing room so the line never touches the top or bottom edge.
  const padding = (max - min) * 0.18 || 1;
  max += padding;
  min -= padding;
  const range = max - min || 1;

  const points = values.map((v, i) => [
    (i / (count - 1)) * (width - 14) + 7,
    height - 14 - ((v - min) / range) * (height - 28)
  ]);
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round1(x)} ${round1(y)}`).join(' ');
  const referenceY =
    reference !== undefined && reference !== null
      ? height - 14 - ((reference - min) / range) * (height - 28)
      : null;
  const last = points[count - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity="0.28" />
          <stop offset="1" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>

      {referenceY !== null && (
        <>
          <line
            x1="0" y1={round1(referenceY)} x2={width} y2={round1(referenceY)}
            stroke={readColour('--ink-3')} strokeWidth="1" strokeDasharray="4 3"
          />
          <text x="3" y={round1(referenceY - 4)} fontSize="8.5" fill={readColour('--ink-3')}>
            {referenceLabel}
          </text>
        </>
      )}

      <path d={`${line} L${round1(last[0])} ${height} L${round1(points[0][0])} ${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />
      {/* A dot on the most recent point, because that is the one being decided on today. */}
      <circle cx={round1(last[0])} cy={round1(last[1])} r="3.4" fill={colour} stroke={readColour('--surface')} strokeWidth="1.6" />
    </svg>
  );
}

// --- Donut --------------------------------------------------------------------
// One proportion, drawn as a ring. The trick is stroke-dasharray: the circle's outline
// becomes a dashed line whose single dash is exactly as long as the share we want to show.

export function Donut({ fraction, colour, size = 96, label, sublabel, strokeWidth }) {
  const width = strokeWidth || 8;
  const radius = strokeWidth ? size / 2 - strokeWidth / 2 - 1 : size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, fraction)));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth={width} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={colour} strokeWidth={width}
        strokeLinecap="round" strokeDasharray={round1(circumference)} strokeDashoffset={round1(offset)}
        // Without this the ring would start at 3 o'clock instead of 12.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {label && (
        <text x={size / 2} y={size / 2 + 2} textAnchor="middle" fontSize="18" fontWeight="700" fill="currentColor">
          {label}
        </text>
      )}
      {sublabel && (
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.7">
          {sublabel}
        </text>
      )}
    </svg>
  );
}

export function Meter({ percent, colour }) {
  return (
    <div className="bar">
      <span style={{ width: `${Math.max(3, Math.min(100, percent))}%`, background: colour }} />
    </div>
  );
}

// --- The three vendor charts together -----------------------------------------
// Delivery, quality and price side by side. Used on the vendor screen and again on the
// order detail, because the same three facts answer "should I sign this?".

export function VendorCharts({ vendor }) {
  if (!vendor || !vendor.scored) {
    return <p className="muted">Not enough completed orders to show a trend yet.</p>;
  }

  const delays = vendor.history.map((o) => o.daysLate);
  const quality = vendor.history.map((o) => o.qualityPercent);
  const rates = vendor.history.map((o) => o.rate);
  const latestQuality = quality[quality.length - 1];
  const overContract = vendor.percentOverContract > 0;
  const worsening = vendor.trend === 'getting worse';

  return (
    <div className="c3grid">
      <ChartBox
        icon="truck"
        title="Delivery"
        subtitle={`${vendor.onTimePercent} percent on time, ${vendor.averageDaysLate} days late on average`}
        tone={worsening ? 'neg' : 'pos'}
        footer={`${vendor.earlierDaysLate} days before, ${vendor.recentDaysLate} days now`}
        footerIcon={worsening ? 'up' : 'down'}
      >
        <DeliveryBars values={delays} />
      </ChartBox>

      <ChartBox
        icon="check"
        title="Quality"
        subtitle={`${vendor.averageQuality} percent accepted`}
        tone={vendor.averageQuality < 97 ? 'warn' : 'pos'}
        footer={`last load ${latestQuality} percent`}
      >
        <TrendLine values={quality} colour={toneColour('pos')} />
      </ChartBox>

      <ChartBox
        icon="chart"
        title="Rate"
        subtitle={`₹${vendor.latestRate.toLocaleString('en-IN')} per ${vendor.unit}`}
        tone={overContract ? 'neg' : 'pos'}
        footer={`${overContract ? '+' : ''}${vendor.percentOverContract} percent against contract`}
        footerIcon={overContract ? 'up' : 'down'}
      >
        <TrendLine values={rates} colour={overContract ? toneColour('neg') : toneColour('pri')} reference={vendor.contractRate} />
      </ChartBox>
    </div>
  );
}

function ChartBox({ icon, title, subtitle, children, tone, footer, footerIcon }) {
  return (
    <div className="cbox">
      <div className="ct">
        <Icon name={icon} size={13} />
        {title}
      </div>
      <div className="cs">{subtitle}</div>
      {children}
      <div className={`cf ${tone}`}>
        {footerIcon && <Icon name={footerIcon} size={12} />}
        {footer}
      </div>
    </div>
  );
}
