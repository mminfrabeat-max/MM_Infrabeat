// The offline data source. Reads the JSON files in server/data and returns them in the
// shapes described in provider.js.
//
// It exists for two reasons. First, it let every screen be built before touching SAP, so
// when a screen breaks later we know the bug is in the SAP mapping and not in the screen.
// Second, some of what this dashboard needs genuinely does not exist in SAP at all, so
// parts of it keep coming from here permanently. Every file says at the top which of its
// fields are real and which are invented.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const dataFolder = path.resolve(thisFolder, '../../data');

// Reading from disk on every request would be wasteful, so each file is read once and
// kept in memory. Restart the backend to pick up an edit to a JSON file.
const cache = new Map();

async function readDataFile(filename) {
  if (cache.has(filename)) return cache.get(filename);

  try {
    const text = await fs.readFile(path.join(dataFolder, filename), 'utf8');
    const parsed = JSON.parse(text);
    cache.set(filename, parsed);
    return parsed;
  } catch (error) {
    // Two very different problems, two very different messages.
    if (error.code === 'ENOENT') throw new Error(`Demo data file is missing: ${filename}`);
    throw new Error(`Demo data file ${filename} is not valid JSON: ${error.message}`);
  }
}

export const mockProvider = {
  name: 'mock',

  async getSuppliers() {
    return (await readDataFile('suppliers.json')).suppliers;
  },

  // SIMULATED. Delivery and quality per order do not exist in the sandbox.
  async getSupplierHistory() {
    return (await readDataFile('supplier-history.json')).history;
  },

  async getPurchaseDocuments() {
    return (await readDataFile('purchase-documents.json')).documents;
  },

  async getMaterials() {
    return (await readDataFile('stock.json')).materials;
  },

  // SIMULATED. Workflow work items, stuck reasons and absences are not in the sandbox.
  async getSituations() {
    return (await readDataFile('situations.json')).situations;
  },

  async getCommitments() {
    const file = await readDataFile('commitments.json');
    return {
      openOrders: file.openOrders,
      openRequests: file.openRequests,
      contracts: file.contracts
    };
  },

  // SIMULATED. What people are working on is not ERP data at all.
  async getTeams() {
    return (await readDataFile('teams.json')).teams;
  }
};
