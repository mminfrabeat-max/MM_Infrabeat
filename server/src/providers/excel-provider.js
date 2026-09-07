// The Excel data source. Keeps the same promise as every other provider, so nothing above
// this layer changes just because the data lives in a spreadsheet.
//
// Notice how little there is here. The awkward parts - caching, type fixing, file locks,
// reassembling item lines and departmental demand - are all in excel-store.js, and the
// business rules are in domain/. This file only answers the seven questions in provider.js.

import { loadWorkbook } from '../excel-store.js';

export const excelProvider = {
  name: 'excel',

  async getSuppliers() {
    return (await loadWorkbook()).suppliers;
  },

  // The workbook holds one flat row per order. The rest of the backend wants the history
  // grouped by vendor, so the grouping happens here.
  async getSupplierHistory() {
    const data = await loadWorkbook();
    const bySupplier = {};
    for (const row of data.supplierHistory) {
      if (!bySupplier[row.supplierId]) bySupplier[row.supplierId] = [];
      bySupplier[row.supplierId].push({
        order: row.order,
        month: row.month,
        daysLate: row.daysLate,
        qualityPercent: row.qualityPercent,
        rate: row.rate
      });
    }
    return bySupplier;
  },

  async getPurchaseDocuments() {
    return (await loadWorkbook()).documents;
  },

  async getMaterials() {
    return (await loadWorkbook()).materials;
  },

  async getSituations() {
    return (await loadWorkbook()).situations;
  },

  async getCommitments() {
    const data = await loadWorkbook();
    return {
      openOrders: data.openOrders,
      openRequests: data.openRequests,
      contracts: data.contracts
    };
  },

  async getTeams() {
    return (await loadWorkbook()).teams;
  }
};
