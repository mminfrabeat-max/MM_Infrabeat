// The layer between the routes and the data source.
//
// Routes should be thin: take a request, hand back an answer. Everything that involves
// fetching from the provider and applying the business rules happens here, in one place,
// so no route has to know how a supplier score is calculated or where documents come from.
//
// Every function here wraps the provider call in try/catch and rethrows with a message a
// person can read. When the SAP provider arrives in milestone 4, a network failure will
// surface as "Could not reach SAP" on screen rather than a blank page.

import { getProvider } from './providers/index.js';
import { scoreAllSuppliers, lowestScoring } from './domain/supplier-score.js';
import { assessAllMaterials } from './domain/stock-risk.js';
import { enrichAllDocuments } from './domain/documents.js';
import { buildToday } from './domain/today.js';

// Fetches several things at once and fails with a clear message naming what broke.
// Promise.all runs them in parallel, which matters once these are real network calls.
async function loadFrom(provider, methods) {
  try {
    const results = await Promise.all(methods.map((m) => provider[m]()));
    // Turn the array back into an object keyed by method name, so callers can destructure.
    return Object.fromEntries(methods.map((m, i) => [m, results[i]]));
  } catch (error) {
    throw new Error(
      `Could not load data from the ${provider.name} source. ${error.message}`
    );
  }
}

// Suppliers with their reliability scores, keyed by supplier id.
export async function getSupplierScores() {
  const provider = getProvider();
  const { getSuppliers, getSupplierHistory } = await loadFrom(provider, [
    'getSuppliers',
    'getSupplierHistory'
  ]);
  return scoreAllSuppliers(getSuppliers, getSupplierHistory);
}

// Purchase documents, each joined to its supplier's score and a recommendation.
export async function getDocuments() {
  const provider = getProvider();
  const [scoresById, documents] = await Promise.all([
    getSupplierScores(),
    provider.getPurchaseDocuments()
  ]);
  return enrichAllDocuments(documents, scoresById);
}

// Materials with days of cover and whether they run out before a delivery could arrive.
export async function getStock() {
  const provider = getProvider();
  const { getMaterials } = await loadFrom(provider, ['getMaterials']);
  return assessAllMaterials(getMaterials);
}

export async function getSituations() {
  const provider = getProvider();
  const { getSituations } = await loadFrom(provider, ['getSituations']);
  return getSituations;
}

export async function getAgentRun() {
  const provider = getProvider();
  const { getAgentRun } = await loadFrom(provider, ['getAgentRun']);
  return getAgentRun;
}

// Everything the Today screen needs, assembled in one call so the screen makes one
// request instead of five and never shows half a picture.
export async function getToday() {
  const [documents, materials, scoresById, situations] = await Promise.all([
    getDocuments(),
    getStock(),
    getSupplierScores(),
    getSituations()
  ]);

  return buildToday({
    documents,
    materials,
    scoresById,
    worstSupplier: lowestScoring(scoresById),
    situations
  });
}
