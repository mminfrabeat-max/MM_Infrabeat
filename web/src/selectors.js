// Small functions that pick things out of the dashboard payload.
//
// These live here rather than inside screens for one reason: the plant selector at the top
// of the page changes what nearly every screen shows, and the filtering rule needs to be
// written once. A screen that filtered its own way would quietly disagree with the tile
// count next to it.
//
// Nothing here decides anything. The business rules are all in the backend; these only
// choose which rows to look at.

export function byPlant(rows, plant) {
  if (!rows) return [];
  if (plant === 'all') return rows;
  return rows.filter((r) => r.plant === plant);
}

// Mirrors server/src/domain/approvals.js. The server decides for real - it is the only
// side that can - but the screen has to know whether to draw a button before it asks.
// If the two ever disagree, the server wins and the click comes back as an error.
export function stillNeedsSigning(document) {
  if (document.status !== "pending") return false;
  if (!document.decidedAt) return true;
  return Boolean(document.next && document.next.name);
}

// True when a click records the NEXT approver decision rather than making your own.
export function recordingForNext(document) {
  return stillNeedsSigning(document) && Boolean(document.decidedAt);
}

export function pendingDocuments(documents, plant) {
  return byPlant(documents, plant).filter((d) => d.status === 'pending');
}

// Orders and requisitions are approved in different places now, so the counts on the two
// tabs have to be counted separately. `kind` is 'PO' or 'PR'.
export function pendingOfKind(documents, plant, kind) {
  return pendingDocuments(documents, plant).filter((d) => d.kind === kind);
}

// Everything of one kind, whatever its status - what each approval list shows.
export function documentsOfKind(documents, plant, kind) {
  return byPlant(documents, plant).filter((d) => d.kind === kind);
}

export function overdueDocuments(documents, plant, hours = 24) {
  return pendingDocuments(documents, plant)
    .filter((d) => d.hoursWaiting > hours)
    .sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

export function sumTotals(documents) {
  return documents.reduce((sum, d) => sum + d.total, 0);
}

export function sumValues(rows) {
  return rows.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
}

// Materials that are short against real demand, or that run out before a new load lands.
export function shortMaterials(materials, plant) {
  return byPlant(materials, plant).filter((m) => m.shortBy > 0 || m.runsOutFirst);
}

export function contractsToWatch(contracts, plant) {
  return byPlant(contracts, plant).filter((c) => c.needsAttention);
}

export function openSituations(situations, plant) {
  return byPlant(situations, plant).filter((s) => s.status === 'open');
}

export function teamsNeedingNudge(teams, plant) {
  return byPlant(teams, plant).filter((t) => t.state === 'nudge');
}

// The vendor with the lowest standing among those actually visible at this plant. Falls
// back to the overall worst when no document at this plant names a scored vendor.
export function weakestVendor(suppliers) {
  const scored = (suppliers || []).filter((s) => s.scored);
  if (scored.length === 0) return null;
  return scored.reduce((worst, s) => (s.total < worst.total ? s : worst));
}

export function findDocument(documents, id) {
  return (documents || []).find((d) => d.id === id) || null;
}

// The stock row for a document's material at that document's plant, used to price what
// happens if the order is sent back.
export function materialFor(materials, document) {
  if (!document) return null;
  return (materials || []).find((m) => m.code === document.materialCode) || null;
}
