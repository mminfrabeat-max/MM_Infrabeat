// The live data source. Not built yet - this is milestone 4.
//
// It is written now, empty, for a reason: it makes the shape of the work visible. Each
// method below names the SAP service it will call, and the four that delegate to the
// mock provider mark exactly where this dashboard shows invented data no matter which
// data source is selected.
//
// SAP terms in this file are deliberate. This is the one layer allowed to know them,
// because its whole job is translating them into the plain business shapes in
// provider.js. Nothing above this layer, and nothing on screen, should ever say
// "A_PurchaseOrder" or "release strategy".

import { mockProvider } from './mock-provider.js';

function notBuiltYet(what, service) {
  return new Error(
    `Live ${what} is not built yet. It arrives in milestone 4 and will read ${service}. ` +
      `Set DATA_SOURCE=mock in your .env to use the demo data.`
  );
}

export const sapProvider = {
  name: 'sap',

  // --- Real SAP data, to be implemented in milestone 4 -----------------------

  async getSuppliers() {
    // Will read API_BUSINESS_PARTNER, entity A_Supplier
    throw notBuiltYet('supplier data', 'API_BUSINESS_PARTNER');
  },

  async getPurchaseDocuments() {
    // Will read API_PURCHASEORDER_PROCESS_SRV (A_PurchaseOrder, A_PurchaseOrderItem)
    // and API_PURCHASEREQ_PROCESS_SRV (A_PurchaseRequisitionHeader)
    throw notBuiltYet('purchase documents', 'the purchase order and requisition services');
  },

  async getMaterials() {
    // Will read API_PRODUCT_SRV (A_Product, A_ProductPlant) and
    // API_MATERIAL_STOCK_SRV (A_MaterialStock)
    throw notBuiltYet('material and stock data', 'the product and material stock services');
  },

  // --- Always simulated, whichever data source is selected -------------------
  //
  // These four have no equivalent in the SAP sandbox at all. Not "not built yet" -
  // the data is simply not there to fetch. See the _why note at the top of each
  // JSON file for what a real system would need in order to produce them.

  async getSupplierHistory() {
    return mockProvider.getSupplierHistory();
  },

  async getSituations() {
    return mockProvider.getSituations();
  },

  async getAgentRun() {
    return mockProvider.getAgentRun();
  }
};
