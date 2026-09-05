// THE INTERFACE. This file defines the contract, and holds no working code.
//
// An "interface" is a promise about what methods exist and what they return. Every
// provider below must keep that promise. Because they all keep it, the rest of the
// backend can call getSuppliers() without knowing or caring whether the answer came
// from a JSON file on this laptop or from a live ERP system on the other side of the
// world. That is the whole point: swap the source, change nothing else.
//
// The shapes below are BUSINESS shapes, not SAP shapes. When SapProvider is written in
// milestone 4, its job is to translate SAP's field names into exactly these shapes. If
// SAP's names leaked through to here, every screen would have to change the day the
// company moves to a different system.
//
// A provider must implement:
//
//   getSuppliers()          -> [ Supplier ]
//   getSupplierHistory()    -> { [supplierId]: [ HistoryEntry ] }
//   getPurchaseDocuments()  -> [ PurchaseDocument ]
//   getMaterials()          -> [ Material ]
//   getSituations()         -> [ Situation ]
//   getAgentRun()           -> AgentRun
//
// All six are async, because the SAP versions will be network calls. The mock ones do
// not need to be, but they are anyway so that swapping providers never changes a caller.
//
// ---------------------------------------------------------------------------
// Supplier          { id, name, category, contractRate, unit }
// HistoryEntry      { order, month, daysLate, qualityPercent, rate, value }
// PurchaseDocument  { id, type: 'order' | 'request', supplierId, material,
//                     materialCode, plant, quantity, unit, rate, contractRate,
//                     value, deliveryDate, hoursWaiting, heldWith, step, rule,
//                     reason, status: 'pending' | 'approved' | 'rejected' }
// Material          { code, name, plant, onHand, unit, safetyStock, reorderPoint,
//                     openOrderQuantity, dailyUsage, leadTimeDays,
//                     supplierId, supplierName }
// Situation         { id, category, severity, icon, title, detail, relatedTo,
//                     detectedAt, cause, proposedFix, canAutoFix, status }
// AgentRun          { completedAt, scope, steps: [...], savingsBasis: [...] }
// ---------------------------------------------------------------------------

// The list of methods every provider must have. Used by assertValidProvider below so a
// half-finished provider fails loudly at startup instead of quietly at 3pm in a demo.
export const REQUIRED_METHODS = [
  'getSuppliers',
  'getSupplierHistory',
  'getPurchaseDocuments',
  'getMaterials',
  'getSituations',
  'getAgentRun'
];

export function assertValidProvider(provider, name) {
  const missing = REQUIRED_METHODS.filter((m) => typeof provider[m] !== 'function');
  if (missing.length > 0) {
    throw new Error(
      `The ${name} data source is missing these methods: ${missing.join(', ')}`
    );
  }
}
