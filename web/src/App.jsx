// The shell: sign-in gate, header, tabs, and which screen is showing.
//
// There is no routing library. Which screen is visible is a piece of state, and switching
// tabs sets it. That is enough for eight tabs and keeps one fewer thing to learn. If we
// later need shareable URLs, that is the moment to add React Router, not before.
//
// One thing worth understanding before reading further: the whole dashboard is loaded in a
// single call and held here. The plant selector then filters it in the browser, so changing
// plant re-draws every screen instantly rather than going back to the server eight times.

import { useState, useEffect, useCallback } from 'react';
import { api, setSignedOutHandler } from './api.js';
import { COMPANY, PRODUCT, APPROVER_NAME, USER_PROFILE, PLANTS } from './brand.js';
import { initials, clock } from './format.js';
import { Icon, Loading, ErrorPanel } from './components/ui.jsx';
import { Wordmark, WordmarkFallback, Modal, Toasts } from './components/shell-bits.jsx';
import { findDocument, pendingDocuments, shortMaterials, contractsToWatch, openSituations, teamsNeedingNudge } from './selectors.js';
import { answer, SUGGESTIONS } from './assistant.js';

import Login from './screens/Login.jsx';
import Overview from './screens/Overview.jsx';
import Approvals from './screens/Approvals.jsx';
import DocumentDetail from './screens/DocumentDetail.jsx';
import Stock from './screens/Stock.jsx';
import Commitments from './screens/Commitments.jsx';
import Vendors from './screens/Vendors.jsx';
import Teams from './screens/Teams.jsx';
import Problems from './screens/Problems.jsx';
import EmailPreview from './screens/EmailPreview.jsx';

// Minutes credited per action. These are assumptions about effort avoided, not measured
// savings, which is why the log shows them per action rather than as one headline number.
const MINUTES = { decision: 12, fix: 20, request: 18, mail: 6, call: 3 };

export default function App() {
  // 'checking' until we know, then a session object or null. Starting at 'checking' matters:
  // assuming signed out would flash the sign-in screen on every page refresh.
  const [session, setSession] = useState('checking');
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [tab, setTab] = useState('overview');
  const [openDocumentId, setOpenDocumentId] = useState(null);
  const [plant, setPlant] = useState('all');
  const [theme, setTheme] = useState('light');

  const [toasts, setToasts] = useState([]);
  const [actions, setActions] = useState([]);
  const [savedMinutes, setSavedMinutes] = useState(0);

  const [busy, setBusy] = useState(null);
  const [decideError, setDecideError] = useState(null);

  const [showProfile, setShowProfile] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [mailDraft, setMailDraft] = useState(null);
  const [showAsk, setShowAsk] = useState(false);
  const [chat, setChat] = useState([]);
  const [askText, setAskText] = useState('');

  // --- Session ---------------------------------------------------------------

  useEffect(() => {
    api.session().then((r) => setSession(r.signedIn ? r : null)).catch(() => setSession(null));
  }, []);

  // If any request comes back 401 the session has gone. Return the whole app to sign-in at
  // once, rather than leaving eight broken tabs.
  useEffect(() => {
    setSignedOutHandler(() => {
      setSession(null);
      setData(null);
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await api.dashboard());
    } catch (error) {
      setLoadError(error.message);
    }
  }, []);

  useEffect(() => {
    if (session && session !== 'checking') load();
  }, [session, load]);

  // --- Small helpers ---------------------------------------------------------

  function toast(tone, icon, message) {
    setToasts((list) => [...list, { id: Date.now() + Math.random(), tone, icon, message }]);
  }

  function credit(what, minutes) {
    setActions((list) => [{ at: clock(), what, minutes }, ...list]);
    setSavedMinutes((m) => m + minutes);
  }

  function navigate(nextTab) {
    setTab(nextTab);
    setOpenDocumentId(null);
    setDecideError(null);
    window.scrollTo(0, 0);
  }

  function openDocument(id) {
    setTab('approvals');
    setOpenDocumentId(id);
    setDecideError(null);
    window.scrollTo(0, 0);
  }

  // --- Actions ---------------------------------------------------------------

  async function decide(id, action, note = '') {
    setBusy(action);
    setDecideError(null);
    try {
      const result = action === 'approve' ? await api.approve(id, note) : await api.reject(id, note);
      await load();
      credit(`${action === 'approve' ? 'Approved' : 'Sent back'} ${id}`, MINUTES.decision);
      toast(
        result.email.sent ? 'pos' : 'warn',
        result.email.sent ? 'check' : 'alert',
        result.email.sent
          ? `${id} ${result.status}. Saved, and mailed to ${result.email.to}.`
          : `${id} ${result.status}. Saved to the workbook, but the mail did not go: ${result.email.status.replace(/^Not sent: /, '')}`
      );
    } catch (error) {
      setDecideError(error.message);
      toast('neg', 'alert', error.message);
    } finally {
      setBusy(null);
    }
  }

  async function fixProblem(situation) {
    setBusy(situation.id);
    try {
      await api.fixSituation(situation.id);
      await load();
      credit(`Fixed ${situation.id}, ${situation.title.toLowerCase()}`, MINUTES.fix);
      toast('pos', 'check', `Done. ${situation.fix}`);
    } catch (error) {
      toast('neg', 'alert', error.message);
    } finally {
      setBusy(null);
    }
  }

  async function raiseRequest(material) {
    setBusy(material.code);
    try {
      const result = await api.raiseRequest(material.code, material.plant);
      await load();
      credit(`Raised a request for ${material.name} at ${material.plant}`, MINUTES.request);
      toast(
        'pri',
        'box',
        `Request prepared for ${result.quantity.toLocaleString('en-IN')} ${result.unit} of ${material.name}, ready for the buyer.`
      );
    } catch (error) {
      toast('neg', 'alert', error.message);
    } finally {
      setBusy(null);
    }
  }

  async function sendMail() {
    const draft = mailDraft;
    setBusy('mail');
    try {
      const result = await api.sendMail(draft.to, draft.subject, draft.body);
      setMailDraft(null);
      credit(`Mailed ${draft.name || draft.to}`, MINUTES.mail);
      toast(
        result.sent ? 'pos' : 'warn',
        result.sent ? 'check' : 'alert',
        result.sent
          ? `Sent to ${draft.name || draft.to} at ${draft.to}.`
          : `Not sent: ${result.status.replace(/^Not sent: /, '')}`
      );
    } catch (error) {
      toast('neg', 'alert', error.message);
    } finally {
      setBusy(null);
    }
  }

  function ask(question) {
    if (!question.trim()) return;
    setChat((c) => [...c, { who: 'u', text: question }]);
    const result = answer(question, data, plant);
    if (result.plant) setPlant(result.plant);
    if (result.goTo) navigate(result.goTo);
    if (result.openDocument) openDocument(result.openDocument);
    setTimeout(() => setChat((c) => [...c, { who: 'a', text: result.text }]), 200);
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setData(null);
      setShowProfile(false);
    }
  }

  // --- Render ----------------------------------------------------------------

  if (session === 'checking') {
    return <div className="loginpage"><Loading what="your session" /></div>;
  }
  if (!session) return <Login onSignedIn={setSession} />;

  if (loadError) {
    return (
      <div className="wrap" style={{ paddingTop: 30 }}>
        <ErrorPanel message={loadError} onRetry={load} />
      </div>
    );
  }
  if (!data) {
    return <div className="wrap"><Loading what="the dashboard" /></div>;
  }

  const openDoc = findDocument(data.documents, openDocumentId);

  const TABS = [
    { key: 'overview', label: 'Overview', icon: 'chart' },
    { key: 'approvals', label: 'Waiting for approval', icon: 'doc', count: pendingDocuments(data.documents, plant).length },
    { key: 'stock', label: 'Stock risk', icon: 'box', count: shortMaterials(data.materials, plant).length },
    { key: 'open', label: 'Open orders and contracts', icon: 'file', count: contractsToWatch(data.contracts, plant).length },
    { key: 'suppliers', label: 'Vendors', icon: 'truck' },
    { key: 'team', label: 'Team performance', icon: 'people', count: teamsNeedingNudge(data.teams, plant).length },
    { key: 'situations', label: 'Problems found', icon: 'alert', count: openSituations(data.situations, plant).length },
    { key: 'email', label: 'Approval by email', icon: 'mail' }
  ];

  return (
    <>
      <header className="shell">
        <div className="shell-in">
          <button className="brand" onClick={() => navigate('overview')} type="button">
            <Wordmark />
            <WordmarkFallback />
            <span className="bdiv" />
            <span className="bstack">
              <span className="b1">{COMPANY}</span>
              <span className="b2">{PRODUCT}</span>
            </span>
          </button>

          <span className="sp" />

          <select className="sel" value={plant} onChange={(e) => setPlant(e.target.value)} aria-label="Choose plant">
            <option value="all">All plants</option>
            {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Names the appearance you are currently in, so the control says what it is
              rather than leaving you to work out what a lone moon means. */}
          <button
            className="hdrbtn"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} appearance`}
            type="button"
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
            <span className="hide-sm">{theme === 'light' ? 'Light' : 'Dark'}</span>
          </button>

          <button className="pillbtn" onClick={() => setShowAsk(true)} type="button">
            <Icon name="spark" size={15} />
            Ask
          </button>

          {/* Sign out sits in the header, not buried in the account menu. It is how you
              leave the application, and a control that important should never need hunting
              for. It is also still in the account panel, for anyone who looks there first. */}
          <button className="hdrbtn danger" onClick={signOut} title="End this session" type="button">
            <Icon name="back" size={16} />
            <span className="hide-sm">Sign out</span>
          </button>

          {/* The account menu: who you are, and everything about your access. */}
          <button
            className={`userbtn${showProfile ? ' open' : ''}`}
            onClick={() => setShowProfile((v) => !v)}
            aria-expanded={showProfile}
            aria-haspopup="menu"
            title={`${APPROVER_NAME}, ${USER_PROFILE.role}`}
            type="button"
          >
            <span className="me">{initials(APPROVER_NAME)}</span>
            <span className="uname hide-sm">{APPROVER_NAME}</span>
            <span className="ucaret"><Icon name="chevron" size={14} /></span>
          </button>
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
              {t.count > 0 && <span className="cnt n">{t.count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="wrap content">
        {tab === 'overview' && (
          <Overview
            data={data}
            plant={plant}
            onNavigate={navigate}
            onOpenDocument={openDocument}
            onOpenLog={() => setShowLog(true)}
            savedMinutes={savedMinutes}
            actionCount={actions.length}
          />
        )}

        {tab === 'approvals' && !openDoc && (
          <Approvals data={data} plant={plant} onOpenDocument={openDocument} />
        )}
        {tab === 'approvals' && openDoc && (
          <DocumentDetail
            data={data}
            document={openDoc}
            canDecide={data.canDecide}
            busy={busy}
            error={decideError}
            onBack={() => setOpenDocumentId(null)}
            onDecide={(action, note) => decide(openDoc.id, action, note)}
          />
        )}

        {tab === 'stock' && (
          <Stock data={data} plant={plant} canDecide={data.canDecide} onRaiseRequest={raiseRequest} busyCode={busy} />
        )}
        {tab === 'open' && <Commitments data={data} plant={plant} />}
        {tab === 'suppliers' && <Vendors data={data} plant={plant} />}
        {tab === 'team' && (
          <Teams
            data={data}
            plant={plant}
            onWriteMail={setMailDraft}
            onCall={(t) => {
              credit(`Called ${t.lead}, ${t.name}`, MINUTES.call);
              toast('pri', 'phone', `Calling ${t.lead} on ${t.phone}. Their usual reply time by mail is ${t.replyTime}.`);
            }}
            onAddTask={(t) => {
              credit(`Added a task for ${t.name}`, 4);
              toast('pos', 'check', `Task added for ${t.name}. ${t.follow}`);
            }}
          />
        )}
        {tab === 'situations' && (
          <Problems
            data={data}
            plant={plant}
            canDecide={data.canDecide}
            onFix={fixProblem}
            onWriteMail={setMailDraft}
            busyId={busy}
          />
        )}
        {tab === 'email' && (
          <EmailPreview
            data={data}
            plant={plant}
            mailTo={data.user.email}
            canDecide={data.canDecide}
            busy={busy}
            onDecide={(id, action) => decide(id, action)}
          />
        )}
      </main>

      {showProfile && (
        <>
          <div className="mscrim" style={{ background: 'transparent' }} onClick={() => setShowProfile(false)} />
          <aside className="prof" style={{ top: 62 }} aria-label="Your account">
            <div className="phd">
              <span className="pav">{initials(APPROVER_NAME)}</span>
              <div>
                <div className="pn">{APPROVER_NAME}</div>
                <div className="pr">{USER_PROFILE.role}, {USER_PROFILE.dept}</div>
              </div>
            </div>
            <div className="pbd">
              <div className="psec">CONTACT</div>
              <ProfileRow k="Email" v={data.user.email} />
              <ProfileRow k="Mobile" v={USER_PROFILE.mobile} />
              <ProfileRow k="Extension" v={USER_PROFILE.ext} />
              <div className="psec">IN SAP</div>
              <ProfileRow k="Employee ID" v={USER_PROFILE.empId} />
              <ProfileRow k="SAP user" v={USER_PROFILE.sapUser} />
              <ProfileRow k="Authorisation" v={USER_PROFILE.release} />
              <ProfileRow k="Plants" v={USER_PROFILE.plants} />
              <div className="psec">WORK</div>
              <ProfileRow k="Location" v={USER_PROFILE.location} />
              <ProfileRow k="Reports to" v={USER_PROFILE.reportsTo} />
              <ProfileRow k="Stand-in" v={USER_PROFILE.standIn} />
              <div className="psec">SIGN IN</div>
              <ProfileRow k="This session" v={USER_PROFILE.lastLogin} />
              <ProfileRow k="Before that" v={USER_PROFILE.prevLogin} />
            </div>
            <div className="pset">
              <button className="pitem" type="button" onClick={() => { setTheme(theme === 'light' ? 'dark' : 'light'); }}>
                <span className="pi"><Icon name="moon" size={14} /></span>
                Appearance
                <span className="pv">{theme === 'light' ? 'Light' : 'Dark'}</span>
              </button>
              <button className="pitem out" type="button" onClick={signOut}>
                <span className="pi"><Icon name="back" size={14} /></span>
                Sign out
              </button>
            </div>
          </aside>
        </>
      )}

      {showLog && (
        <Modal
          icon="clock"
          title="What you have done today"
          onClose={() => setShowLog(false)}
          footer={
            <>
              <span style={{ fontSize: '12.9px', color: 'var(--ink-2)' }}>
                {actions.length} {actions.length === 1 ? 'action' : 'actions'}, {savedMinutes} minutes saved
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn q" type="button" onClick={() => setShowLog(false)}>Close</button>
            </>
          }
        >
          {actions.length === 0 ? (
            <div className="logempty">
              Nothing yet today. Approve an order, fix a problem or send a mail from here, and each
              one will be listed with the time it saved you. Every action is also written to the
              workbook, so the record survives closing this page.
            </div>
          ) : (
            actions.map((a, i) => (
              <div className="logrow" key={i}>
                <span className="lt n">{a.at}</span>
                <span className="lw">{a.what}</span>
                <span className="lm n">+{a.minutes} min</span>
              </div>
            ))
          )}
        </Modal>
      )}

      {mailDraft && (
        <Modal
          icon="mail"
          title="Write a mail"
          onClose={() => setMailDraft(null)}
          footer={
            <>
              <button className="btn emph" type="button" onClick={sendMail} disabled={busy === 'mail'}>
                <Icon name="send" size={13} />
                {busy === 'mail' ? 'Sending…' : 'Send'}
              </button>
              <button className="btn q" type="button" onClick={() => setMailDraft(null)}>Cancel</button>
            </>
          }
        >
          <div className="mrow">
            <div className="mlab">To</div>
            <input className="minp" value={mailDraft.to} onChange={(e) => setMailDraft({ ...mailDraft, to: e.target.value })} />
          </div>
          <div className="mrow">
            <div className="mlab">Subject</div>
            <input className="minp" value={mailDraft.subject} onChange={(e) => setMailDraft({ ...mailDraft, subject: e.target.value })} />
          </div>
          <div className="mrow" style={{ marginBottom: 0 }}>
            <div className="mlab">Message</div>
            <textarea className="mtxt" value={mailDraft.body} onChange={(e) => setMailDraft({ ...mailDraft, body: e.target.value })} />
          </div>
        </Modal>
      )}

      {showAsk && (
        <>
          <div className="scrim" onClick={() => setShowAsk(false)} />
          <aside className="asst" aria-label="Ask">
            <div className="ahd">
              <span className="ai"><Icon name="spark" size={16} /></span>
              <span>
                <h2>Ask</h2>
                <span className="as">about any order, vendor, material or contract</span>
              </span>
              <button className="x" onClick={() => setShowAsk(false)} type="button" aria-label="Close">&times;</button>
            </div>

            <div className="abd">
              {chat.length === 0 && (
                <div className="msg a">
                  Ask me what is waiting for you, what will run out, or say show only Pune.
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} className={`msg ${m.who === 'u' ? 'u' : 'a'}`}>
                  {m.who === 'u' ? m.text : <Rich text={m.text} />}
                </div>
              ))}
            </div>

            <div className="achips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="achip" type="button" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>

            <div className="afoot">
              <input
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { ask(askText); setAskText(''); } }}
                placeholder="Type your question"
                aria-label="Ask"
              />
              <button className="send" type="button" onClick={() => { ask(askText); setAskText(''); }} aria-label="Send">
                <Icon name="send" size={15} />
              </button>
            </div>
          </aside>
        </>
      )}

      <Toasts items={toasts} onDismiss={(id) => setToasts((list) => list.filter((t) => t.id !== id))} />
    </>
  );
}

function ProfileRow({ k, v }) {
  return (
    <div className="prow">
      <span className="k">{k}</span>
      <span>{v}</span>
    </div>
  );
}

// The assistant marks emphasis with **double asterisks**. Rendering it by splitting on the
// marker keeps the text safe: nothing typed anywhere can become markup.
function Rich({ text }) {
  return (
    <>
      {String(text)
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, i) =>
          part.startsWith('**') && part.endsWith('**')
            ? <b key={i}>{part.slice(2, -2)}</b>
            : <span key={i}>{part}</span>
        )}
    </>
  );
}
