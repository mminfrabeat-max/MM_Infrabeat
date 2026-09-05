// Milestone 1 screen. Its only job is to prove the full chain works:
// browser -> Vite proxy -> Express backend -> back to the browser.
//
// It also sets the pattern every later screen will follow: three states on screen
// (loading, error, ready) so a failure shows a readable message instead of a blank page.

import { useState, useEffect } from 'react';

export default function App() {
  // useState gives a component a piece of memory that survives re-renders.
  // We keep one object describing which of the three states we are in.
  const [status, setStatus] = useState({ state: 'loading' });

  // useEffect runs code after the component appears on screen. The empty array [] at the
  // end means "run this once, when the component first mounts", not on every re-render.
  useEffect(() => {
    // If the component disappears before the network call finishes, we must not try to
    // update its memory - React would warn about updating an unmounted component.
    let cancelled = false;

    async function loadHealth() {
      try {
        // Relative URL on purpose: the Vite proxy forwards it to port 3001.
        const response = await fetch('/api/health');

        // fetch only throws on network failure, NOT on 404 or 500. We have to check
        // response.ok ourselves, otherwise a 500 would be treated as success.
        if (!response.ok) {
          throw new Error(`The backend replied with status ${response.status}`);
        }

        const data = await response.json();
        if (!cancelled) setStatus({ state: 'ready', data });
      } catch (error) {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: `Could not reach the backend. ${error.message}`
          });
        }
      }
    }

    loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Procurement Dashboard</h1>
        <p className="subtitle">Milestone 1 &mdash; connection check</p>
      </header>

      {status.state === 'loading' && <p className="muted">Checking the backend&hellip;</p>}

      {status.state === 'error' && (
        <div className="panel panel-error">
          <h2>Backend unavailable</h2>
          <p>{status.message}</p>
          <p className="muted">
            Is the backend running? It should be listening on http://localhost:3001
          </p>
        </div>
      )}

      {status.state === 'ready' && (
        <div className="panel panel-ok">
          <h2>Connected</h2>
          <p>
            This box was filled in by the backend, not by the browser. If you can read
            it, the whole chain works.
          </p>
          <dl className="facts">
            <dt>Service</dt>
            <dd>{status.data.service}</dd>
            <dt>Data source</dt>
            <dd>{status.data.dataSource}</dd>
            <dt>SAP key loaded</dt>
            <dd>{status.data.sapKeyLoaded ? 'yes' : 'no'}</dd>
            <dt>Checked at</dt>
            <dd>{new Date(status.data.checkedAt).toLocaleTimeString()}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
