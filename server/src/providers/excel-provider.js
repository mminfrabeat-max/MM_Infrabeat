// The Excel data source. Keeps the same promise as every other provider, so nothing
// above this layer changes just because the data now lives in a spreadsheet.
//
// Notice how little there is here. All the awkward parts - caching, type fixing, file
// locks - are in excel-store.js, and all the business rules are in domain/. This file
// only has to answer the six questions in provider.js.
//
// The one shape difference worth knowing: supplier history is a flat table in the
// workbook, one row per order, because that is what a spreadsheet is good at. The rest
// of the backend wants it grouped by supplier, so the grouping happens here.

import { loadWorkbook } from '../excel-store.js';

export const excelProvider = {
  name: 'excel',

  async getSuppliers() {
    const data = await loadWorkbook();
    return data.suppliers;
  },

  async getSupplierHistory() {
    const data = await loadWorkbook();

    // Flat rows in, grouped by supplier out.
    const bySupplier = {};
    for (const row of data.supplierHistory) {
      const id = row.supplierId;
      if (!bySupplier[id]) bySupplier[id] = [];
      bySupplier[id].push({
        order: row.order,
        month: row.month,
        daysLate: row.daysLate,
        qualityPercent: row.qualityPercent,
        rate: row.rate,
        value: row.value
      });
    }
    return bySupplier;
  },

  async getPurchaseDocuments() {
    const data = await loadWorkbook();
    return data.documents;
  },

  async getMaterials() {
    const data = await loadWorkbook();
    return data.materials;
  },

  async getSituations() {
    const data = await loadWorkbook();
    return data.situations;
  },

  // The morning run is a description of a scheduled job, not business data, so it stays
  // in JSON rather than becoming a spreadsheet nobody would ever edit.
  async getAgentRun() {
    const { mockProvider } = await import('./mock-provider.js');
    return mockProvider.getAgentRun();
  }
};
