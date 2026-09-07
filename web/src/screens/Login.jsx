// The sign-in screen.
//
// Nothing else in the app renders until this succeeds, so it is deliberately plain: one
// card, two fields, one button, and a clear message when something is wrong.

import { useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/ui.jsx';

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  // Tracks whether a sign-in is in flight, so the button can be disabled. Without this,
  // an impatient double-click sends the request twice.
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    // A form would otherwise reload the whole page, throwing away our React app.
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const session = await api.login(username, password);
      onSignedIn(session);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="loginpage">
      <form className="logincard" onSubmit={handleSubmit}>
        <div className="loginbrand">
          <span className="logo">NC</span>
          <div>
            <div className="b1">Procurement Dashboard</div>
            <div className="b2">Northline Cement</div>
          </div>
        </div>

        <h1>Sign in</h1>
        <p className="muted loginlede">
          This dashboard shows live purchasing and supplier information, so it is not open
          to everyone.
        </p>

        {error && (
          <div className="loginerror" role="alert">
            <Icon name="alert" size={14} />
            <span>{error}</span>
          </div>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            // Puts the cursor here when the page opens, so you can just start typing.
            autoFocus
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button className="btn emph loginbtn" type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        <p className="loginfoot">
          Five wrong attempts locks the account for ten minutes.
        </p>
      </form>
    </div>
  );
}
