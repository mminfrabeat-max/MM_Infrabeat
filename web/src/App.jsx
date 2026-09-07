// The shell: the sign-in gate, the top bar, the tabs, and which screen is showing.
//
// There is no routing library here. Which screen is visible is just a piece of state,
// and switching tabs sets it. That is enough for a dashboard with six tabs, and it keeps
// one fewer thing to learn in the project. If we later need shareable URLs, that is the
// moment to add React Router, not before.

import { useState, useEffect } from 'react';
import { api, setSignedOutHandler } from './api.js';
import { Icon, Loading } from './components/ui.jsx';
import Login from './screens/Login.jsx';
import Today from './screens/Today.jsx';
import Situations from './screens/Situations.jsx';
import Approvals from './screens/Approvals.jsx';
import Suppliers from './screens/Suppliers.jsx';
import Stock from './screens/Stock.jsx';
import Activity from './screens/Activity.jsx';

const TABS = [
  { key: 'today', label: 'Today', icon: 'chart' },
  { key: 'situations', label: 'Problems', icon: 'alert' },
  { key: 'approvals', label: 'Approvals', icon: 'doc' },
  { key: 'suppliers', label: 'Suppliers', icon: 'truck' },
  { key: 'stock', label: 'Stock risk', icon: 'box' },
  { key: 'activity', label: 'Activity', icon: 'spark' }
];

export default function App() {
  // 'checking' until we know, then either a session object or null.
  // Starting at 'checking' matters: if we assumed signed out, the sign-in screen would
  // flash on every page refresh before the answer came back.
  const [session, setSession] = useState('checking');
  const [tab, setTab] = useState('today');
  // Which document the Approvals screen has open, if any. Kept here rather than inside
  // Approvals so that a card on the Today screen can open a document directly.
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [theme, setTheme] = useState('light');
  const [health, setHealth] = useState(null);

  // Ask once, on load, whether the browser already holds a valid session cookie. This is
  // what stops a refresh from making you sign in again.
  useEffect(() => {
    api
      .session()
      .then((result) => setSession(result.signedIn ? result : null))
      .catch(() => setSession(null));
  }, []);

  // If any screen's request comes back 401, the session has expired. Return the whole
  // app to the sign-in screen at once, rather than leaving six broken tabs.
  useEffect(() => {
    setSignedOutHandler(() => setSession(null));
  }, []);

  // The top bar shows which data source is live. Only ask once signed in, since the
  // health route is open but the answer is only shown inside the dashboard.
  useEffect(() => {
    if (!session || session === 'checking') return;
    api.health().then(setHealth).catch(() => setHealth(null));
  }, [session]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // One navigation function passed down to every screen, so a screen never needs to know
  // how navigation works, only that it can ask for another tab.
  function navigate(nextTab, documentId = null) {
    setTab(nextTab);
    setSelectedDocument(documentId);
    window.scrollTo(0, 0);
  }

  async function handleSignOut() {
    try {
      await api.logout();
    } finally {
      // Clear the screen even if the request failed, so "sign out" always looks like it
      // worked. The cookie expires on its own regardless.
      setSession(null);
      setTab('today');
      setSelectedDocument(null);
    }
  }

  if (session === 'checking') {
    return (
      <div className="loginpage">
        <Loading what="your session" />
      </div>
    );
  }

  if (!session) {
    return <Login onSignedIn={setSession} />;
  }

  return (
    <>
      <header className="shell">
        <div className="shell-in">
          <button className="brand" onClick={() => navigate('today')} type="button">
            <span className="logo">NC</span>
            <span>
              <span className="b1">Procurement Dashboard</span>
              <span className="b2">Northline Cement</span>
            </span>
          </button>

          <span className="sp" />

          {health && (
            <span className={`sourcechip ${health.dataSource === 'sap' ? 'live' : ''}`}>
              {health.dataSource === 'sap' ? 'Live data' : 'Demonstration data'}
            </span>
          )}

          <button
            className="iconbtn"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            aria-label="Switch between light and dark"
            type="button"
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} />
          </button>

          <button className="signout" onClick={handleSignOut} type="button" title={session.username}>
            Sign out
          </button>

          <span className="me" title={session.username}>RM</span>
        </div>
      </header>

      <nav className="nav">
        <div className="nav-in" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              className="navb"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => navigate(t.key)}
              type="button"
            >
              <Icon name={t.icon} size={15} />
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="wrap content">
        {tab === 'today' && <Today onNavigate={navigate} />}
        {tab === 'situations' && <Situations />}
        {tab === 'approvals' && <Approvals selectedId={selectedDocument} onNavigate={navigate} />}
        {tab === 'suppliers' && <Suppliers />}
        {tab === 'stock' && <Stock />}
        {tab === 'activity' && <Activity />}
      </main>
    </>
  );
}
