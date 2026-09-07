// Every call from the browser to our backend goes through here.
//
// One place, so error handling is written once and behaves the same on every screen. The
// rule we agreed: a failure shows a clear message, never a blank page and never a crash.

// When a session expires, every screen starts getting 401 at once. Rather than each one
// showing its own error, the app registers a single handler here and we call it, so the
// whole app returns to the sign-in screen together.
let onSignedOut = null;

export function setSignedOutHandler(handler) {
  onSignedOut = handler;
}

// fetch() only throws when the network itself fails. A 404 or a 500 counts as a successful
// round trip as far as fetch is concerned, so we have to check ourselves.
async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(path, {
      ...options,
      // Tells fetch to send and accept our session cookie. Without this the browser leaves
      // the cookie behind and every request looks signed out.
      credentials: 'same-origin'
    });
  } catch {
    throw new Error('Could not reach the backend. Check that it is running on http://localhost:3001');
  }

  if (response.status === 401 && !path.endsWith('/login')) {
    if (onSignedOut) onSignedOut();
    throw new Error('Your session has ended. Please sign in again.');
  }

  // The backend sends a readable sentence in an "error" field. Prefer that over a bare
  // status code, because "4500178401 was already approved" beats "409".
  if (!response.ok) {
    let message = `The backend replied with status ${response.status}`;
    try {
      const body = await response.json();
      if (body && body.error) message = body.error;
    } catch {
      // Body was not JSON. Keep the status-code message.
    }
    throw new Error(message);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('The backend sent a reply that was not readable.');
  }
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

export const api = {
  // Sign-in. The password is sent once here and never stored by the browser: the reply is
  // a cookie the browser holds and JavaScript cannot read.
  login: (username, password) => post('/api/login', { username, password }),
  logout: () => post('/api/logout'),
  session: () => request('/api/session'),
  health: () => request('/api/health'),

  // One call for the whole dashboard, so the plant selector can re-filter every screen
  // without going back to the server.
  dashboard: () => request('/api/dashboard'),

  // Actions. Each writes to the Excel workbook and then sends its email.
  approve: (id, note) => post(`/api/approvals/${encodeURIComponent(id)}/approve`, { note }),
  reject: (id, note) => post(`/api/approvals/${encodeURIComponent(id)}/reject`, { note }),
  fixSituation: (id) => post(`/api/situations/${encodeURIComponent(id)}/fix`),
  raiseRequest: (code, plant) => post(`/api/materials/${encodeURIComponent(code)}/request`, { plant }),
  sendMail: (to, subject, body) => post('/api/mail', { to, subject, body }),
  actionLog: () => request('/api/action-log')
};
