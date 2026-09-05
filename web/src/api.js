// Every call from the browser to our backend goes through here.
//
// One place, so error handling is written once and behaves the same on every screen.
// The rule we agreed: a failure shows a clear message, never a blank page and never a
// crash. That rule is kept here rather than repeated in seven screens.

// fetch() only throws when the network itself fails. A 404 or a 500 counts as a
// successful round trip as far as fetch is concerned, so we have to check ourselves.
async function request(path) {
  let response;

  try {
    response = await fetch(path);
  } catch (networkError) {
    // Nothing answered at all. Almost always the backend is not running.
    throw new Error(
      'Could not reach the backend. Check that it is running on http://localhost:3001'
    );
  }

  // The backend sends a readable sentence in an "error" field. Prefer that over a bare
  // status code, because "No document found with the number 123" beats "404".
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

export const api = {
  health: () => request('/api/health'),
  today: () => request('/api/today'),
  situations: () => request('/api/situations'),
  agentActivity: () => request('/api/agent-activity'),
  approvals: () => request('/api/approvals'),
  approval: (id) => request(`/api/approvals/${encodeURIComponent(id)}`),
  suppliers: () => request('/api/suppliers'),
  stock: () => request('/api/stock')
};
