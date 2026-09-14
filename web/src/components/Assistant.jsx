// The assistant panel.
//
// Docked to the right and nothing behind it is dimmed, because the questions worth asking
// are about what is on the screen. A panel that greys out the tiles you are asking about is
// a modal wearing a different shape - you read a number, open the panel, and the number you
// wanted to ask about is gone. The page gives up width instead; the tiles stay readable.
//
// Three kinds of thing appear in the thread:
//
//   a message   - yours or its, rendered as markdown so a table is a table
//   a proposal  - something it wants to do, with Confirm and Cancel. Nothing happens until
//                 one of those is pressed, and the panel cannot say what the action is -
//                 the server is holding it
//   a chip      - one tappable suggestion, either an opener or a single follow-up
//
// The opening lines are read off live data before a single question is asked, which is the
// difference between a box that says "how can I help" and one that says "PO 4500178401 is
// ten days past its delivery date".

import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './ui.jsx';
import Markdown from './markdown.jsx';

export default function Assistant({ open, onClose, filter, onActed }) {
  const [thread, setThread] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [openers, setOpeners] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const bottom = useRef(null);
  const input = useRef(null);

  // Opening lines, read once when the panel first opens. Not on every open: they come off
  // the same data the screens show, and re-reading them each time the panel is toggled is
  // a round trip to tell somebody something they just read.
  useEffect(() => {
    if (!open || status) return;

    let cancelled = false;
    (async () => {
      try {
        const [about, suggestions] = await Promise.all([api.assistantStatus(), api.assistantOpeners()]);
        if (cancelled) return;
        setStatus(about);
        setOpeners(suggestions.openers || []);
      } catch (problem) {
        if (!cancelled) setError(problem.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, status]);

  // Follow the conversation down as it grows, and put the cursor where somebody can type.
  useEffect(() => {
    if (!open) return;
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread, busy, open]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Tells the page to make room. A class on the body rather than a prop threaded through
  // the layout, so opening the panel changes no other component - and the cleanup means a
  // panel that unmounts while open cannot leave the page permanently narrowed.
  useEffect(() => {
    document.body.classList.toggle('asst-open', open);
    return () => document.body.classList.remove('asst-open');
  }, [open]);

  async function send(question) {
    const asked = String(question || '').trim();
    if (!asked || busy) return;

    setText('');
    setError(null);
    setThread((t) => [...t, { who: 'you', text: asked }]);
    setBusy(true);

    try {
      const reply = await api.assistantAsk(asked, filter);
      setThread((t) => [
        ...t,
        reply.kind === 'proposal'
          ? { who: 'it', proposal: reply }
          : { who: 'it', text: reply.text, next: reply.next || null }
      ]);
    } catch (problem) {
      setThread((t) => [...t, { who: 'it', text: problem.message, failed: true }]);
    } finally {
      setBusy(false);
    }
  }

  // Yes or no to whatever the server is holding. The panel sends a boolean and nothing
  // else - it has no way to name the action, so nothing on this page can choose one.
  async function settle(index, approved) {
    setBusy(true);
    setThread((t) => t.map((m, i) => (i === index ? { ...m, settled: approved ? 'done' : 'cancelled' } : m)));

    try {
      const reply = await api.assistantConfirm(approved);
      setThread((t) => [...t, { who: 'it', text: reply.text }]);

      // A file is handed over here rather than through a link, because the CSV only ever
      // existed in the reply.
      if (reply.result?.content && reply.result?.filename) {
        save(reply.result.filename, reply.result.content);
      }

      // Something changed underneath the screens, so they are told to re-read.
      if (approved && reply.result?.done) onActed?.();
    } catch (problem) {
      setThread((t) => [...t, { who: 'it', text: problem.message, failed: true }]);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    api.assistantReset().catch(() => {});
    setThread([]);
    setError(null);
  }

  if (!open) return null;

  const unavailable = status && !status.available;

  return (
    <aside className="asst" aria-label="Ask">
      <div className="ahd">
        <span className="ai">
          <Icon name="spark" size={16} />
        </span>
        <span>
          <h2>Ask</h2>
          <span className="as">about any order, vendor, material or contract</span>
        </span>
        <button className="x" onClick={onClose} type="button" aria-label="Close">
          &times;
        </button>
      </div>

      <div className="abd">
        {unavailable && (
          <div className="msg a">
            <b>The assistant is not switched on.</b>
            <br />
            Add <code className="mdcode">GEMINI_API_KEY</code> to the backend&rsquo;s .env file and restart it.
            Until then the Ask box still answers from the dashboard&rsquo;s own rules — close this panel and
            use the old one.
          </div>
        )}

        {error && <div className="msg a">{error}</div>}

        {thread.length === 0 && !unavailable && (
          <>
            <div className="msg a">
              Ask me what is waiting, what is short, or where an order has got to. I can send a reminder,
              export a list or flag something for later — each of those I will describe first and only do
              when you press the button.
            </div>

            {openers.length > 0 && (
              <div className="aopen">
                <div className="aopenh">Right now</div>
                {openers.map((opener) => (
                  <button key={opener.ask} className="aline" type="button" onClick={() => send(opener.ask)}>
                    <Icon name="alert" size={13} />
                    <span>{opener.text}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {thread.map((message, i) =>
          message.proposal ? (
            <Proposal
              key={i}
              proposal={message.proposal}
              settled={message.settled}
              busy={busy}
              onConfirm={() => settle(i, true)}
              onCancel={() => settle(i, false)}
            />
          ) : (
            <div key={i} className={`msg ${message.who === 'you' ? 'u' : 'a'}${message.failed ? ' bad' : ''}`}>
              {message.who === 'you' ? message.text : <Markdown text={message.text} />}
            </div>
          )
        )}

        {/* One follow-up, on the last reply only. More than one is a menu, and a menu is
            what this panel exists to replace. */}
        {!busy && followUp(thread) && (
          <button className="achip one" type="button" onClick={() => send(followUp(thread).ask)}>
            {followUp(thread).label}
          </button>
        )}

        {busy && (
          <div className="msg a thinking">
            <span className="dots"><i /><i /><i /></span>
            Checking SAP data…
          </div>
        )}

        <div ref={bottom} />
      </div>

      <div className="afoot">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          placeholder={unavailable ? 'Not switched on' : 'Type your question'}
          aria-label="Ask"
          disabled={busy || unavailable}
        />
        <button
          className="send"
          type="button"
          onClick={() => send(text)}
          aria-label="Send"
          disabled={busy || unavailable}
        >
          <Icon name="send" size={15} />
        </button>
      </div>

      {thread.length > 0 && (
        <button className="aclear" type="button" onClick={clear} disabled={busy}>
          Start again
        </button>
      )}
    </aside>
  );
}

function Proposal({ proposal, settled, busy, onConfirm, onCancel }) {
  return (
    <div className="cq aprop">
      <div className="cqh">
        <Icon name={settled === 'done' ? 'check' : settled === 'cancelled' ? 'alert' : 'shield'} size={13} />{' '}
        {proposal.summary}
      </div>

      {(proposal.detail || []).map((line, i) => (
        <div key={i} className="cqt">
          {line}
        </div>
      ))}

      {settled === 'done' ? (
        <div className="cqt">
          <b>Confirmed.</b>
        </div>
      ) : settled === 'cancelled' ? (
        <div className="cqt">
          <b>Cancelled.</b> Nothing was changed.
        </div>
      ) : (
        <div className="tacts">
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn emph" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : proposal.confirmLabel}
          </button>
        </div>
      )}
    </div>
  );
}

// The single next step offered after an answer.
//
// Picked from what the answer is about rather than from a fixed list, and only ever one.
// Nothing is offered after a proposal: the next step there is to press a button that is
// already on the screen.
function followUp(thread) {
  const last = thread[thread.length - 1];
  if (!last || last.who !== 'it' || last.proposal || last.failed) return null;

  const said = String(last.text || '').toLowerCase();

  if (/past (its|their) delivery date|days late|overdue/.test(said)) {
    return { label: 'Remind whoever is holding these', ask: 'Remind whoever is holding the late ones.' };
  }
  if (/days of cover|short by|runs out/.test(said)) {
    return { label: 'Who should we buy it from?', ask: 'Which vendor should we buy that from, on their record?' };
  }
  if (/waiting for approval|pending|partially approved/.test(said)) {
    return { label: 'Export this list', ask: 'Export that list as a CSV file.' };
  }
  if (/out of 100|on time|quality/.test(said)) {
    return { label: 'What is open with them?', ask: 'What is currently open with that vendor?' };
  }
  return null;
}

// Hands a file to the browser. The CSV was made on the server and travelled in the reply,
// so there is nothing to fetch - it is turned into a blob and offered under its own name.
function save(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
