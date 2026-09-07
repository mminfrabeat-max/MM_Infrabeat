// The layer between the routes and the data source.
//
// Routes should be thin: take a request, hand back an answer. Everything that involves
// fetching from the provider and applying the business rules happens here, in one place,
// so no route has to know how a vendor score is calculated or where documents come from.
//
// Note what is NOT here: filtering by plant. That happens in the browser, because the plant
// selector at the top of the screen changes every number on the page at once and a round
// trip per change would make it feel slow.

import { getProvider } from './providers/index.js';
import { scoreAllSuppliers, lowestScoring } from './domain/supplier-score.js';
import { assessAllMaterials } from './domain/stock-risk.js';
import { assessAllContracts } from './domain/contracts.js';
import { enrichAllDocuments } from './domain/documents.js';

// Fetches several things at once and fails with a clear message naming what broke.
// Promise.all runs them in parallel, which matters once these are real network calls.
async function loadFrom(provider, methods) {
  try {
    const results = await Promise.all(methods.map((m) => provider[m]()));
    return Object.fromEntries(methods.map((m, i) => [m, results[i]]));
  } catch (error) {
    throw new Error(`Could not load data from the ${provider.name} source. ${error.message}`);
  }
}

export async function getSupplierScores() {
  const provider = getProvider();
  const { getSuppliers, getSupplierHistory } = await loadFrom(provider, [
    'getSuppliers',
    'getSupplierHistory'
  ]);
  return scoreAllSuppliers(getSuppliers, getSupplierHistory);
}

export async function getStock() {
  const provider = getProvider();
  const { getMaterials } = await loadFrom(provider, ['getMaterials']);
  return assessAllMaterials(getMaterials);
}

export async function getCommitments() {
  const provider = getProvider();
  const { getCommitments } = await loadFrom(provider, ['getCommitments']);
  return {
    openOrders: getCommitments.openOrders,
    openRequests: getCommitments.openRequests,
    contracts: assessAllContracts(getCommitments.contracts)
  };
}

// Documents need the vendor scores, the stock position and the contracts, because the
// "what happens either way" panel prices sending an order back against how much cover the
// plant has and how much of the contract is left.
export async function getDocuments() {
  const provider = getProvider();
  const [scoresById, stock, commitments, documents] = await Promise.all([
    getSupplierScores(),
    getStock(),
    getCommitments(),
    provider.getPurchaseDocuments()
  ]);
  return enrichAllDocuments(documents, scoresById, stock, commitments.contracts);
}

export async function getSituations() {
  const provider = getProvider();
  const { getSituations } = await loadFrom(provider, ['getSituations']);
  return getSituations;
}

export async function getTeams() {
  const provider = getProvider();
  const { getTeams } = await loadFrom(provider, ['getTeams']);
  return getTeams;
}

// Everything the dashboard needs, in one call.
//
// One request rather than seven, for a real reason: the plant selector re-filters every
// screen at once, so the browser needs the whole picture in hand. Seven separate calls
// would also mean seven chances to show half a page.
export async function getEverything() {
  const [documents, materials, scoresById, situations, commitments, teams] = await Promise.all([
    getDocuments(),
    getStock(),
    getSupplierScores(),
    getSituations(),
    getCommitments(),
    getTeams()
  ]);

  return {
    documents,
    materials,
    suppliers: Object.values(scoresById),
    situations,
    openOrders: commitments.openOrders,
    openRequests: commitments.openRequests,
    contracts: commitments.contracts,
    teams,
    worstSupplier: lowestScoring(scoresById)
  };
}
