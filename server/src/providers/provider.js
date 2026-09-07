// THE INTERFACE. This file defines the contract and holds no working code.
//
// An "interface" is a promise about what methods exist and what they return. Every
// provider must keep that promise. Because they all keep it, the rest of the backend can
// call getSuppliers() without knowing or caring whether the answer came from a spreadsheet
// on this laptop or a live ERP system on the other side of the world.
//
// The shapes are BUSINESS shapes, not SAP shapes. When SapProvider is written, its job is
// to translate SAP's field names into exactly these. If SAP's names leaked through to
// here, every screen would have to change the day the company moves to a different system.
//
// A provider must implement:
//
//   getSuppliers()          -> [ Supplier ]
//   getSupplierHistory()    -> { [supplierId]: [ HistoryEntry ] }
//   getPurchaseDocuments()  -> [ PurchaseDocument ]
//   getMaterials()          -> [ Material ]
//   getSituations()         -> [ Situation ]
//   getCommitments()        -> { openOrders, openRequests, contracts }
//   getTeams()              -> [ Team ]
//
// All are async, because the SAP versions will be network calls. The others need not be,
// but are anyway, so that swapping providers never changes a caller.

export const REQUIRED_METHODS = [
  'getSuppliers',
  'getSupplierHistory',
  'getPurchaseDocuments',
  'getMaterials',
  'getSituations',
  'getCommitments',
  'getTeams'
];

export function assertValidProvider(provider, name) {
  const missing = REQUIRED_METHODS.filter((m) => typeof provider[m] !== 'function');
  if (missing.length > 0) {
    throw new Error(`The ${name} data source is missing these methods: ${missing.join(', ')}`);
  }
}
