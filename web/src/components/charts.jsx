// Every chart on the dashboard, written by hand as SVG. No chart library.
//
// This is less scary than it sounds. An SVG chart is arithmetic plus strings: you turn
// each data value into an x and a y inside a fixed box, then join them into a path.
//
// The one idea that makes it all work is the viewBox. It says "this drawing uses a grid
// 240 wide and 92 tall". The browser then scales that grid to whatever space the chart
// actually gets. So all the maths below can use nice round numbers and never has to care
// about pixels or screen size.
//
// A colour note: these read CSS variables at draw time via readColour(), so the charts
// follow the light and dark themes without carrying their own palette.

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Reads one of the --colour values defined in styles.css.
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

// --- Sparkline -------------------------------------------------------------
// The small shape behind each tile. Shows direction only, deliberately without axes
// or labels: it answers "which way is this going" and nothing more.

export function SparkArea({ values, colour, width = 96, height = 40 }) {
  const id = nextId();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - 4 - ((v - min) / range) * (height - 12)
  ]);

  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round1(x)} ${round1(y)}`)
    .join(' ');

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

// --- Delivery bars ---------------------------------------------------------
// One bar per order, height is how many days late. Bars sit above or below a zero line,
// so an early delivery visibly points the other way.

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

  // Where zero sits vertically. Everything is measured from here.
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
      <text x="2" y={height - 2} fontSize="9" fill={readColour('--ink-3')}>
        10 orders ago
      </text>
      <text x={width - 2} y={height - 2} textAnchor="end" fontSize="9" fill={readColour('--ink-3')}>
        latest
      </text>
    </svg>
  );
}

// --- Line with a filled area ----------------------------------------------
// Used for quality and price over the last ten orders. The optional reference line is
// what makes the price chart useful: it shows the agreed rate, so "above the line" means
// "costing more than agreed" at a glance.

export function TrendLine({ values, colour, reference, referenceLabel = 'agreed rate' }) {
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

  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round1(x)} ${round1(y)}`)
    .join(' ');

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
            x1="0"
            y1={round1(referenceY)}
            x2={width}
            y2={round1(referenceY)}
            stroke={readColour('--ink-3')}
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          <text x="3" y={round1(referenceY - 4)} fontSize="8.5" fill={readColour('--ink-3')}>
            {referenceLabel}
          </text>
        </>
      )}

      <path
        d={`${line} L${round1(last[0])} ${height} L${round1(points[0][0])} ${height} Z`}
        fill={`url(#${id})`}
      />
      <path d={line} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />
      {/* A dot on the most recent point, because that is the one being decided on today. */}
      <circle
        cx={round1(last[0])}
        cy={round1(last[1])}
        r="3.4"
        fill={colour}
        stroke={readColour('--surface')}
        strokeWidth="1.6"
      />
    </svg>
  );
}

// --- Donut -----------------------------------------------------------------
// One proportion, drawn as a ring. The trick is stroke-dasharray: the circle's outline is
// turned into a dashed line whose single dash is exactly as long as the share we want to
// show, and the gap is the rest.

export function Donut({ fraction, colour, size = 96, label, sublabel }) {
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.max(0, Math.min(1, fraction));
  const offset = circumference * (1 - safe);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="8"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={colour}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={round1(circumference)}
        strokeDashoffset={round1(offset)}
        // Without this the ring would start at 3 o'clock instead of 12.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {label && (
        <text x={size / 2} y={size / 2 + 2} textAnchor="middle" fontSize="19" fontWeight="700" fill="currentColor">
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

// --- Progress bar ----------------------------------------------------------

export function Meter({ percent, colour }) {
  return (
    <div className="bar">
      <span style={{ width: `${Math.max(3, Math.min(100, percent))}%`, background: colour }} />
    </div>
  );
}

// --- The three supplier charts together ------------------------------------
// Delivery, quality and price side by side. Used on the supplier screen and again on the
// approval detail, because the same three facts answer "should I sign this?".

export function SupplierCharts({ supplier }) {
  if (!supplier || !supplier.scored) {
    return <p className="muted">Not enough completed orders to show a trend yet.</p>;
  }

  const delays = supplier.history.map((o) => o.daysLate);
  const quality = supplier.history.map((o) => o.qualityPercent);
  const rates = supplier.history.map((o) => o.rate);
  const latestQuality = quality[quality.length - 1];
  const overContract = supplier.percentOverContract > 0;

  return (
    <div className="c3grid">
      <ChartBox
        icon="truck"
        title="Delivery"
        subtitle={`${supplier.onTimePercent}% within a day of promise, ${supplier.averageDaysLate} days late on average`}
        tone={supplier.trend === 'worsening' ? 'neg' : 'pos'}
        footer={`${supplier.earlierDaysLate} days then, ${supplier.recentDaysLate} days now`}
        footerIcon={supplier.trend === 'worsening' ? 'up' : 'down'}
      >
        <DeliveryBars values={delays} />
      </ChartBox>

      <ChartBox
        icon="check"
        title="Quality"
        subtitle={`${supplier.averageQuality}% accepted on average`}
        tone={latestQuality < 97 ? 'warn' : 'pos'}
        footer={`last delivery ${latestQuality}%`}
      >
        <TrendLine values={quality} colour={toneColour('pos')} />
      </ChartBox>

      <ChartBox
        icon="chart"
        title="Price"
        subtitle={`₹${supplier.latestRate.toLocaleString('en-IN')} per ${supplier.unit}`}
        tone={overContract ? 'neg' : 'pos'}
        footer={`${overContract ? '+' : ''}${supplier.percentOverContract}% against the agreement`}
        footerIcon={overContract ? 'up' : 'down'}
      >
        <TrendLine
          values={rates}
          colour={overContract ? toneColour('neg') : toneColour('pri')}
          reference={supplier.contractRate}
        />
      </ChartBox>
    </div>
  );
}

function ChartBox({ icon, title, subtitle, children, tone, footer, footerIcon }) {
  return (
    <div className="cbox">
      <div className="ct">
        <IconInline name={icon} />
        {title}
      </div>
      <div className="cs">{subtitle}</div>
      {children}
      <div className={`cf ${tone}`}>
        {footerIcon && <IconInline name={footerIcon} size={12} />}
        {footer}
      </div>
    </div>
  );
}

// Small local copy so charts.jsx does not have to import from ui.jsx and create a
// circular import between the two component files.
function IconInline({ name, size = 13 }) {
  const paths = {
    truck: 'M3 6h11v8H3V6Zm12 3h3.2l2.8 3.2V17h-2a2.5 2.5 0 0 1-5 0h-1V9Zm-8.5 8a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm11 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z',
    check: 'M9.6 16.4 5.2 12l-1.4 1.4 5.8 5.8L20.2 8.6 18.8 7.2 9.6 16.4Z',
    chart: 'M3 20h18v1.6H3V20Zm2-6h3v5H5v-5Zm5-5h3v10h-3V9Zm5-5h3v15h-3V4Z',
    up: 'M12 5 5.6 11.4 7 12.8l4-4V19h2V8.8l4 4 1.4-1.4L12 5Z',
    down: 'M12 19l6.4-6.4L17 11.2l-4 4V5h-2v10.2l-4-4L5.6 12.6 12 19Z'
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={paths[name] || paths.chart} />
    </svg>
  );
}
