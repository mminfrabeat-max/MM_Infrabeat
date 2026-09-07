// Chooses which data source the backend uses, based on DATA_SOURCE in .env.
//
// This is the only file that knows both providers exist. Everything else imports
// getProvider() and gets whichever one is configured. That single choke point is what
// makes "switch to live SAP data" a one-line change in a settings file rather than a
// hunt through the codebase.

import { config, hasSapKey } from '../config.js';
import { mockProvider } from './mock-provider.js';
import { excelProvider } from './excel-provider.js';
import { sapProvider } from './sap-provider.js';
import { assertValidProvider } from './provider.js';

const providers = {
  mock: mockProvider,
  excel: excelProvider,
  sap: sapProvider
};

// Worked out once at startup rather than on every request.
const selected = providers[config.dataSource];

if (!selected) {
  throw new Error(
    `DATA_SOURCE in your .env is "${config.dataSource}", which is not a data source. ` +
      `Use "excel", "mock" or "sap".`
  );
}

// Fail at startup, not halfway through a demo, if a provider is incomplete.
assertValidProvider(selected, config.dataSource);

// Selecting live data without a key would produce a wall of confusing 401 errors later.
// Better to refuse to start and say why.
if (config.dataSource === 'sap' && !hasSapKey) {
  throw new Error(
    'DATA_SOURCE is "sap" but SAP_API_KEY is missing from your .env. ' +
      'Add the key, or set DATA_SOURCE=mock.'
  );
}

export function getProvider() {
  return selected;
}

// True when any part of the answer is invented rather than read from a real system.
// The screens use this to be honest with whoever is looking at them.
export function usesSimulatedData() {
  return true; // Situations, supplier history and the morning run are always simulated.
}
