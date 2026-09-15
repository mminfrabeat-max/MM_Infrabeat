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
import { recipientFor } from './domain/recipients.js';

import { promises as nodeFs } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The people in each team, and the purchase group they buy under.
//
// Read straight off a file rather than through a provider, because it is neither SAP data
// nor something the workbook can hold: teams.json is mirrored into a spreadsheet one row
// per team, and a row cannot carry a list of people. Keeping it here means adding somebody
// to a team is editing one file, and means the workbook stays a mirror of SAP rather than
// half a mirror and half an address book.
const rosterFile = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '../data/team-roster.json');
let rosterCache = null;

async function getRoster() {
  if (rosterCache) return rosterCache;
  try {
    const parsed = JSON.parse(await nodeFs.readFile(rosterFile, 'utf8'));
    rosterCache = parsed.teams || [];
  } catch {
    // A missing or broken roster leaves every team with no members and no purchase group,
    // which is exactly how the screens behaved before it existed. Nothing breaks.
    rosterCache = [];
  }
  return rosterCache;
}

// Everything the dashboard needs, in one call.
//
// One request rather than seven, for a real reason: the plant selector re-filters every
// screen at once, so the browser needs the whole picture in hand. Seven separate calls
// would also mean seven chances to show half a page.
export async function getEverything() {
  const [documents, materials, scoresById, situations, commitments, teams, roster] = await Promise.all([
    getDocuments(),
    getStock(),
    getSupplierScores(),
    getSituations(),
    getCommitments(),
    getTeams(),
    getRoster()
  ]);

  return {
    documents,
    materials,
    suppliers: Object.values(scoresById),
    situations,
    openOrders: commitments.openOrders,
    openRequests: commitments.openRequests,
    contracts: commitments.contracts,
    teams: teams.map(withReminderMailbox).map((team) => {
      const extra = roster.find((r) => r.teamId === team.id);
      return {
        ...team,
        purchaseGroup: extra?.purchaseGroup || '',
        purchaseGroupName: extra?.purchaseGroupName || '',
        members: extra?.members || []
      };
    }),
    worstSupplier: lowestScoring(scoresById)
  };
}

// Whether a reminder to this team lead will reach anybody - and nothing more than that.
//
// A flag, not an address. The mailbox itself is fetched one name at a time when the compose
// window opens, because this payload is held in the page for the whole session and is what
// the shareable offline copy is built from. A true or false costs nothing in either.
//
// What it buys is the warning on the row: a team with nobody on file is worth knowing about
// before you write the reminder rather than after you send it.
function withReminderMailbox(team) {
  return { ...team, reminderReaches: recipientFor(team.lead).real };
}
