// The offline data source. Reads the JSON files in server/data and returns them in the
// shapes described in provider.js.
//
// This exists for two reasons. First, it let us build every screen before touching SAP,
// so when a screen breaks later we know the bug is in the SAP mapping and not in the
// screen. Second, some of what this dashboard needs genuinely does not exist in the SAP
// sandbox, so parts of the demo will keep coming from here even after milestone 4. Every
// file it reads says at the top which of its fields are real and which are invented.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const dataFolder = path.resolve(thisFolder, '../../data');

// Reading a file from disk takes a few milliseconds. Doing it on every request would be
// wasteful, so each file is read once and the result kept in memory. Restart the backend
// to pick up an edit to a JSON file.
const cache = new Map();

async function readDataFile(filename) {
  if (cache.has(filename)) return cache.get(filename);

  const fullPath = path.join(dataFolder, filename);
  try {
    const text = await fs.readFile(fullPath, 'utf8');
    const parsed = JSON.parse(text);
    cache.set(filename, parsed);
    return parsed;
  } catch (error) {
    // Two very different problems produce very different messages, so say which it is.
    if (error.code === 'ENOENT') {
      throw new Error(`Demo data file is missing: ${filename}`);
    }
    throw new Error(`Demo data file ${filename} is not valid JSON: ${error.message}`);
  }
}

export const mockProvider = {
  name: 'mock',

  async getSuppliers() {
    const file = await readDataFile('suppliers.json');
    return file.suppliers;
  },

  // SIMULATED. Delivery and quality per order do not exist in the sandbox.
  async getSupplierHistory() {
    const file = await readDataFile('supplier-history.json');
    return file.history;
  },

  async getPurchaseDocuments() {
    const file = await readDataFile('purchase-documents.json');
    return file.documents;
  },

  async getMaterials() {
    const file = await readDataFile('stock.json');
    return file.materials;
  },

  // SIMULATED. Workflow work items, stuck reasons and absences are not in the sandbox.
  async getSituations() {
    const file = await readDataFile('situations.json');
    return file.situations;
  },

  // SIMULATED. Describes a scheduled morning job we have not built yet.
  async getAgentRun() {
    const file = await readDataFile('agent-run.json');
    return file.run;
  }
};
