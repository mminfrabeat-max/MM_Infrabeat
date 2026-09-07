// The live data source. Not built yet.
//
// It is written now, empty, for a reason: it makes the shape of the work visible. Each
// method names the SAP service it will call, and the ones that delegate elsewhere mark
// exactly where this dashboard shows data that SAP cannot provide no matter what.
//
// SAP terms in this file are deliberate. This is the one layer allowed to know them,
// because its whole job is translating them into the plain business shapes in provider.js.
// Nothing above this layer, and nothing on screen, should ever say "A_PurchaseOrder".
//
// server/data/sap-source-tables.xlsx is the specification for this file. Its FieldMapping
// sheet lists every translation each method below has to perform.

import { mockProvider } from './mock-provider.js';

function notBuiltYet(what, service) {
  return new Error(
    `Live ${what} is not built yet. It will read ${service}. ` +
      `Set DATA_SOURCE=excel in your .env to use the workbook.`
  );
}

export const sapProvider = {
  name: 'sap',

  // --- Real SAP data, to be implemented -------------------------------------

  async getSuppliers() {
    // API_BUSINESS_PARTNER: A_Supplier, plus A_BusinessPartnerAddress for the city and
    // A_BusinessPartnerTaxNumber for GST. The SAP vendor evaluation score has no standard
    // OData service and would need a custom one.
    throw notBuiltYet('vendor data', 'API_BUSINESS_PARTNER');
  },

  async getPurchaseDocuments() {
    // API_PURCHASEORDER_PROCESS_SRV (A_PurchaseOrder with A_PurchaseOrderItem) and
    // API_PURCHASEREQ_PROCESS_SRV (A_PurchaseRequisitionHeader with its item entity).
    // The header alone carries no material, quantity or price, so both must be read.
    throw notBuiltYet('purchase documents', 'the purchase order and requisition services');
  },

  async getMaterials() {
    // API_PRODUCT_SRV (A_Product, A_ProductPlant) for the master data and reorder levels,
    // API_MATERIAL_STOCK_SRV (A_MaterialStock) for quantity on hand, filtered to
    // unrestricted-use stock only.
    throw notBuiltYet('material and stock data', 'the product and material stock services');
  },

  async getCommitments() {
    // Open orders and requisitions from the same services as above, filtered to those not
    // yet delivered. Contracts are outline agreements, with consumption on the item.
    throw notBuiltYet('open orders and contracts', 'the purchasing services');
  },

  // --- Never available from SAP, whichever data source is selected -----------
  //
  // These three have no equivalent in SAP at all. Not "not built yet" - the data is not
  // there to fetch. See the NotAvailableInSAP sheet in sap-source-tables.xlsx.

  async getSupplierHistory() {
    // Would need goods receipts compared against confirmed delivery dates, plus quality
    // inspection lots. Buildable in a real system, but it is a project, not one call.
    return mockProvider.getSupplierHistory();
  },

  async getSituations() {
    // Needs workflow work items, the approver substitution table, leave records and cost
    // centre ownership. No standard OData service exposes any of them.
    return mockProvider.getSituations();
  },

  async getTeams() {
    // What people are working on is not ERP data. A real version would read a task system,
    // a mail server and a calendar.
    return mockProvider.getTeams();
  }
};
