// Pieces of the surrounding frame: the wordmark, modal dialogs and toasts.
//
// These are separate from ui.jsx because they are about the window rather than the
// content. A screen never uses them; only App.jsx does.

import { useEffect } from 'react';
import { WORDMARK } from '../brand.js';
import { Icon } from './ui.jsx';

// The logo, with a text fallback.
//
// An embedded image can fail for reasons we cannot see from here: a corrupted string, a
// content policy, an old browser. A broken-image icon in the header looks far worse than
// clean text, so onError swaps in a wordmark drawn from the name itself.
export function Wordmark() {
  return (
    <img
      className="wordmark"
      alt="InfraBeat"
      src={WORDMARK}
      onError={(e) => {
        const img = e.currentTarget;
        img.style.display = 'none';
        const fallback = img.nextElementSibling;
        if (fallback) fallback.style.display = 'grid';
      }}
    />
  );
}

// Sits immediately after <Wordmark /> and is revealed only if the image fails.
export function WordmarkFallback() {
  return (
    <span
      style={{
        display: 'none',
        placeItems: 'center',
        height: 26,
        padding: '0 10px',
        borderRadius: 7,
        background: 'linear-gradient(135deg,#0079A3,#EB1C24)',
        color: '#fff',
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: '.4px'
      }}
    >
      InfraBeat
    </span>
  );
}

// --- Modal -------------------------------------------------------------------

// A dialog over a dimmed page. Escape closes it, and so does clicking the backdrop,
// because both are what people instinctively try.
export function Modal({ icon, title, onClose, children, footer }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="mscrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mhd">
          {icon && <Icon name={icon} size={18} />}
          {title}
          <button className="x" onClick={onClose} type="button" aria-label="Close">
            &#10005;
          </button>
        </div>
        <div className="mbd">{children}</div>
        {footer && <div className="mft">{footer}</div>}
      </div>
    </>
  );
}

// --- Toasts ------------------------------------------------------------------

// Short confirmations at the bottom of the screen. They disappear on their own, so they
// are only ever used for "that worked", never for anything the person must read.
export function Toasts({ items, onDismiss }) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4600);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="toast" onClick={() => onDismiss(toast.id)}>
      <span className={`ico bg-${toast.tone}`}>
        <Icon name={toast.icon} size={14} />
      </span>
      <div>{toast.message}</div>
    </div>
  );
}
