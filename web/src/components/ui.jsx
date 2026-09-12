// The small presentational pieces every screen reuses: icons, cards, banners, tiles,
// chips and the loading and error states.
//
// None of these know anything about procurement. They take what they are given and draw
// it. Keeping them ignorant is what makes them reusable.

// --- Icons -------------------------------------------------------------------
//
// Each icon is one SVG path on a 24 by 24 grid. Storing just the path data rather than
// whole files keeps them tiny and lets any icon take any size and colour.

const PATHS = {
  bell: 'M12 3a5 5 0 0 0-5 5v3.5L5.5 14v1h13v-1L17 11.5V8a5 5 0 0 0-5-5Zm0 18a2.5 2.5 0 0 0 2.4-1.8H9.6A2.5 2.5 0 0 0 12 21Z',
  spark: 'M12 2.6l1.9 4.9 4.9 1.9-4.9 1.9L12 16.2l-1.9-4.9L5.2 9.4l4.9-1.9L12 2.6Zm6.4 10.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3Z',
  alert: 'M12 3.2 1.6 21h20.8L12 3.2Zm0 5.6c.6 0 1 .5 1 1.1l-.3 4.6a.7.7 0 0 1-1.4 0L11 9.9c0-.6.4-1.1 1-1.1Zm0 8.1a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z',
  check: 'M9.6 16.4 5.2 12l-1.4 1.4 5.8 5.8L20.2 8.6 18.8 7.2 9.6 16.4Z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.6V6h-2v7.4l5 3 1-1.7-4-2.1Z',
  box: 'M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.3 6.3 3.2L12 10.6 5.7 7.5 12 4.3ZM5 9.3l6 3v7.1l-6-3v-7.1Zm14 0v7.1l-6 3v-7.1l6-3Z',
  truck: 'M3 6h11v8H3V6Zm12 3h3.2l2.8 3.2V17h-2a2.5 2.5 0 0 1-5 0h-1V9Zm-8.5 8a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm11 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z',
  doc: 'M6 2h8l4 4v16H6V2Zm7 1.5V7h3.5L13 3.5ZM8.5 11h7v1.6h-7V11Zm0 3.4h7V16h-7v-1.6Z',
  mail: 'M2.5 5.5h19v13h-19v-13Zm1.8 1.8 7.7 5.4 7.7-5.4H4.3Z',
  chart: 'M3 20h18v1.6H3V20Zm2-6h3v5H5v-5Zm5-5h3v10h-3V9Zm5-5h3v15h-3V4Z',
  shield: 'M12 2 4 5.2v6.3c0 5 3.4 9.4 8 10.5 4.6-1.1 8-5.5 8-10.5V5.2L12 2Zm-1 13.4-3.4-3.4L9 10.6l2 2 4-4 1.4 1.4-5.4 5.4Z',
  up: 'M12 5 5.6 11.4 7 12.8l4-4V19h2V8.8l4 4 1.4-1.4L12 5Z',
  down: 'M12 19l6.4-6.4L17 11.2l-4 4V5h-2v10.2l-4-4L5.6 12.6 12 19Z',
  sun: 'M12 6.5A5.5 5.5 0 1 0 12 17.5 5.5 5.5 0 0 0 12 6.5ZM11 1.5h2v3.2h-2V1.5Zm0 17.8h2v3.2h-2v-3.2ZM1.5 11h3.2v2H1.5v-2Zm17.8 0h3.2v2h-3.2v-2ZM4.2 5.6 5.6 4.2l2.3 2.3-1.4 1.4L4.2 5.6Zm11.9 11.9 1.4-1.4 2.3 2.3-1.4 1.4-2.3-2.3Zm2.3-13.3 1.4 1.4-2.3 2.3-1.4-1.4 2.3-2.3ZM4.2 18.4l2.3-2.3 1.4 1.4-2.3 2.3-1.4-1.4Z',
  moon: 'M20 14.6A8.6 8.6 0 0 1 9.4 4 8.6 8.6 0 1 0 20 14.6Z',
  send: 'M2.5 21 22 12 2.5 3v7l13 2-13 2v7Z',
  wrench: 'M20.8 6.3a5.5 5.5 0 0 1-7 7L6 21.1 2.9 18l7.8-7.8a5.5 5.5 0 0 1 7-7l-3.2 3.2 2.1 2.1 3.2-3.2Z',
  eye: 'M12 5C6.5 5 2.3 9.1 1 12c1.3 2.9 5.5 7 11 7s9.7-4.1 11-7c-1.3-2.9-5.5-7-11-7Zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9Zm0-2.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z',
  back: 'M15.4 5 9 11.4l6.4 6.4 1.4-1.4-5-5 5-5L15.4 5Z',
  file: 'M4 3h11a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3Zm3 3v11h9V6H7Zm2 2h5v1.6H9V8Zm0 3.4h5V13H9v-1.6Z',
  phone: 'M6.2 2.8 3.4 5.6c-.5.5-.6 1.2-.4 1.8 2 5.9 6.7 10.6 12.6 12.6.6.2 1.3.1 1.8-.4l2.8-2.8-4.6-2.3-1.8 1.8a15.5 15.5 0 0 1-6.7-6.7l1.8-1.8L6.2 2.8Z',
  people: 'M8.5 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7.5.6a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6ZM8.5 13C5.4 13 2 14.5 2 17v2.6h13V17c0-2.5-3.4-4-6.5-4Zm7.5.6c-.6 0-1.2 0-1.8.2 1.1 1 1.8 2.2 1.8 3.6v2.2h6V17c0-2-2.8-3.4-6-3.4Z',
  chevron: 'M12 15.4 5.6 9 7 7.6l5 5 5-5L18.4 9 12 15.4Z',
  // The three ways goods move. Drawn to read at 14px, where detail is noise: a hull with a
  // wave under it, a carriage on rails, and the truck that was already here.
  ship: 'M4 13h16l-2.2 6H6.2L4 13Zm7-9h2v3h4v4h-2v-2H9v2H7V7h4V4ZM2 20c1.7 0 1.7 1.2 3.3 1.2S7 20 8.7 20s1.7 1.2 3.3 1.2S13.7 20 15.3 20s1.7 1.2 3.4 1.2V23c-1.7 0-1.7-1.2-3.4-1.2S13.7 23 12 23s-1.7-1.2-3.3-1.2S7 23 5.3 23 3.7 21.8 2 21.8V20Z',
  train: 'M7 2h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3ZM6 6v4h5V6H6Zm7 0v4h5V6h-5Zm-4 6.4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5.5 18h13l2.5 4h-3l-1.2-2H7.2L6 22H3l2.5-4Z',
  // Where a leg begins or ends: a port, and the plant at the end of the line.
  anchor: 'M11 2h2v2.2h2.2v2H13v11.5a5.6 5.6 0 0 0 4.8-4.4h-1.9L19 9.8l3.1 3.5h-2a7.6 7.6 0 0 1-7.1 6.6v.2h-.1a7.6 7.6 0 0 1-7.8-6.8H3L6.1 9.8l3.1 3.5H7.3A5.6 5.6 0 0 0 11 17.6V6.2H8.8v-2H11V2Z',
  factory: 'M2 21V9l6 4V9l6 4V4h8v17H2Zm4-2h3v-3H6v3Zm5 0h3v-3h-3v3Zm5 0h3v-3h-3v3Z'
};

export function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={PATHS[name] || PATHS.doc} />
    </svg>
  );
}

// --- Layout ------------------------------------------------------------------

// `id` is what a tile scrolls to. Without one a card cannot be linked to, and the tiles at
// the top of a screen are only summaries of the tables underneath them.
export function Card({ id, span = 'c12', icon, tone = 'pri', title, subtitle, action, flush, children }) {
  return (
    <section className={`card ${span}`} id={id}>
      <div className="chd">
        {icon && (
          <span className={`ico bg-${tone}`}>
            <Icon name={icon} />
          </span>
        )}
        <div>
          <h2>{title}</h2>
          {subtitle && <div className="cs">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className={`cbd${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

// kind: info | warn | err | ok
export function Banner({ kind = 'info', icon = 'eye', children }) {
  const tone = kind === 'err' ? 'neg' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'pos' : 'pri';
  return (
    <div className={`banner ${kind}`}>
      <span className={`ico bg-${tone}`}>
        <Icon name={icon} size={14} />
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Tile({ icon, label, value, unit, sub, tone = 'mut', direction, footer, spark, onClick }) {
  const iconTone = tone === 'mut' ? 'pri' : tone;
  // A tile that goes nowhere should not lift under the cursor and should not be reachable
  // by tab. The hover was promising something half of them could not deliver.
  const clickable = typeof onClick === 'function';
  return (
    <button
      className={`tile${clickable ? ' tile-link' : ''}`}
      onClick={onClick}
      type="button"
      tabIndex={clickable ? 0 : -1}
      aria-disabled={clickable ? undefined : true}
    >
      {spark}
      <span className={`ico bg-${iconTone}`}>
        <Icon name={icon} />
      </span>
      <div className="lab">{label}</div>
      <div className="val n">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div className="sub2 n">{sub}</div>}
      <div className={`foot ${tone}`}>
        {direction && <Icon name={direction} size={13} />}
        {footer}
      </div>
    </button>
  );
}

// tone: pos | warn | neg | pri | mut
// A count with a word under it. Deliberately not the Tile above: a Tile is a way into a
// screen, and these are facts about the list you are already looking at.
export function Count({ label, value, sub, tone = 'mut' }) {
  return (
    <div className="tmet">
      <div className="l">{label}</div>
      <div className={`v ${tone}`}>{value}</div>
      <div className="l">{sub}</div>
    </div>
  );
}

export function Chip({ tone = 'mut', icon, children }) {
  return (
    <span className={`chipx ${tone}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Score({ value, tone, size }) {
  return (
    <span className={`scorepill ${tone}`} style={size ? { fontSize: size } : undefined}>
      {value}
      <small>/100</small>
    </span>
  );
}

export function Facet({ label, value }) {
  return (
    <div className="facet">
      <div className="fl">{label}</div>
      <div className="fv n">{value}</div>
    </div>
  );
}

// One label-and-value line inside the two-column order header.
export function TermRow({ label, value, big }) {
  return (
    <div className="trow">
      <span className="tk">{label}</span>
      <span className={`tv${big ? ' big' : ''}`}>{value}</span>
    </div>
  );
}

export function Metric({ label, value, note, tone }) {
  return (
    <div className="metric">
      <div className="ml">{label}</div>
      <div className={`mv n ${tone}`}>{value}</div>
      <div className="mn">{note}</div>
    </div>
  );
}

// --- The three states --------------------------------------------------------

export function Loading({ what = 'the dashboard' }) {
  return <p className="muted" style={{ padding: '30px 2px' }}>Loading {what}…</p>;
}

export function ErrorPanel({ message, onRetry }) {
  return (
    <div className="panel panel-error">
      <h2>This did not load</h2>
      <p>{message}</p>
      <p className="muted">The dashboard is still running. Nothing was changed and nothing was lost.</p>
      {onRetry && (
        <button className="btn" onClick={onRetry} type="button" style={{ marginTop: 10 }}>
          Try again
        </button>
      )}
    </div>
  );
}

// Shown wherever the numbers underneath are invented rather than read from a real system.
// Being visibly honest about this costs nothing and prevents an awkward conversation later.
export function SimulatedNote({ children }) {
  return (
    <p className="simnote">
      <Icon name="eye" size={12} />
      {children}
    </p>
  );
}
