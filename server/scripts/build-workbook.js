// Creates server/data/procurement.xlsx from the JSON files.
//
//   node server/scripts/build-workbook.js
//
// After that the workbook is the real data. Editing it in Excel changes what the dashboard
// shows, and approving something in the dashboard writes back into it.
//
// It will not overwrite an existing workbook unless you pass --force, because that workbook
// may hold approvals you have made since. This is the sort of guard worth writing on day
// one: the day you need it, you really need it.
//
// There is a third mode, and it is the one you usually want:
//
//   node server/scripts/build-workbook.js --refresh
//
// That rebuilds every sheet from the JSON, so new orders, vendors and materials appear,
// but carries your existing decisions across: which documents were approved or sent back
// and by whom, which problems were marked fixed, which materials had a request raised
// against them, and the whole action log. Adding data should never cost you your history.

import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKBOOK_PATH, SHEETS, COLUMNS, LIST_SEPARATOR } from '../src/excel-schema.js';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const dataFolder = path.resolve(thisFolder, '../data');

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(dataFolder, name), 'utf8'));
}

// A frozen bold header with filter dropdowns is not decoration: it is what makes a
// 200-row sheet usable by a person in Excel.
function addSheet(workbook, name, columns, rows, headerColour = 'FFEEF2F7') {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  for (const row of rows) sheet.addRow(row);

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColour } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

// --- Carrying decisions across a rebuild --------------------------------------
//
// Reads what the app has written into the existing workbook, so a rebuild can put it back.
// Rows are matched by header text rather than column position, the same way the reader
// does it, so a workbook whose columns were dragged around in Excel still works.

function rowsOf(workbook, sheetName, columns) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];

  const keyByColumn = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const header = String(cell.value ?? '').trim();
    const column = columns.find((c) => c.header === header);
    if (column) keyByColumn.set(columnNumber, column.key);
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    let hasSomething = false;
    for (const [columnNumber, key] of keyByColumn) {
      let value = row.getCell(columnNumber).value;
      if (value && typeof value === 'object') {
        value = 'result' in value ? value.result : 'text' in value ? value.text : String(value);
      }
      record[key] = value === null || value === undefined ? '' : value;
      if (record[key] !== '') hasSomething = true;
    }
    if (hasSomething) rows.push(record);
  });
  return rows;
}

async function readExistingDecisions() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);

  const decisions = new Map();
  for (const row of rowsOf(workbook, SHEETS.documents, COLUMNS.documents)) {
    // Only rows somebody actually decided. A pending row carries nothing worth keeping.
    if (row.status && row.status !== 'pending') {
      decisions.set(String(row.id), {
        status: row.status,
        decidedBy: row.decidedBy,
        decidedAt: row.decidedAt,
        decisionNote: row.decisionNote
      });
    }
  }

  const situations = new Map();
  for (const row of rowsOf(workbook, SHEETS.situations, COLUMNS.situations)) {
    if (row.status && row.status !== 'open') situations.set(String(row.id), row.status);
  }

  // Raising a request adds to the quantity on order, which is a decision too.
  const onOrder = new Map();
  for (const row of rowsOf(workbook, SHEETS.materials, COLUMNS.materials)) {
    onOrder.set(`${row.code}@${row.plant}`, Number(row.openOrderQuantity) || 0);
  }

  const actionLog = rowsOf(workbook, SHEETS.actionLog, COLUMNS.actionLog);

  return { decisions, situations, onOrder, actionLog };
}

async function main() {
  const force = process.argv.includes('--force');
  const refresh = process.argv.includes('--refresh');

  // Nothing to carry across on a first run, so this stays empty unless --refresh finds a
  // workbook to read.
  let kept = { decisions: new Map(), situations: new Map(), onOrder: new Map(), actionLog: [] };

  try {
    await fs.access(WORKBOOK_PATH);
    if (refresh) {
      kept = await readExistingDecisions();
    } else if (!force) {
      console.error('');
      console.error(`The workbook already exists: ${WORKBOOK_PATH}`);
      console.error('Refusing to overwrite it, because it may hold decisions you have made.');
      console.error('To rebuild it from the JSON files but keep those decisions, run:');
      console.error('  node server/scripts/build-workbook.js --refresh');
      console.error('To start again from nothing, throwing the decisions away, run:');
      console.error('  node server/scripts/build-workbook.js --force');
      console.error('');
      process.exit(1);
    }
  } catch (error) {
    // ENOENT is the normal first run. Anything else is a real problem and should be said
    // out loud rather than swallowed into a silent rebuild.
    if (error.code !== 'ENOENT') throw error;
  }

  const suppliersFile = await readJson('suppliers.json');
  const historyFile = await readJson('supplier-history.json');
  const documentsFile = await readJson('purchase-documents.json');
  const stockFile = await readJson('stock.json');
  const situationsFile = await readJson('situations.json');
  const commitmentsFile = await readJson('commitments.json');
  const teamsFile = await readJson('teams.json');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'InfraBeat Procurement Dashboard';
  workbook.created = new Date();

  // --- Documents, with the nested parts flattened out -----------------------
  const documentRows = documentsFile.documents.map((d) => ({
    id: d.id,
    kind: d.kind,
    docType: d.docType,
    trade: d.trade,
    incoterm: d.incoterm,
    supplierId: d.supplierId,
    material: d.material,
    materialCode: d.materialCode,
    plant: d.plant,
    quantity: d.quantity,
    unit: d.unit,
    rate: d.rate,
    basic: d.basic,
    freight: d.freight,
    loading: d.loading,
    transport: d.transport,
    payTerms: d.payTerms,
    cashDiscount: d.cashDiscount,
    rebate: d.rebate,
    deliveryDate: d.deliveryDate,
    hoursWaiting: d.hoursWaiting,
    step: d.step,
    reason: d.reason,
    createdByName: d.createdBy ? d.createdBy.name : '',
    createdByTitle: d.createdBy ? d.createdBy.title : '',
    createdByWhen: d.createdBy ? d.createdBy.when : '',
    prevName: d.prev ? d.prev.name : '',
    prevLevel: d.prev ? d.prev.level : '',
    prevWhen: d.prev ? d.prev.when : '',
    prevNote: d.prev ? d.prev.note : '',
    nextName: d.next ? d.next.name : '',
    nextTitle: d.next ? d.next.title : '',
    nextLevel: d.next ? d.next.level : '',
    vesselName: d.vessel ? d.vessel.name : '',
    vesselImo: d.vessel ? d.vessel.imo : '',
    vesselBillOfLading: d.vessel ? d.vessel.billOfLading : '',
    vesselFrom: d.vessel ? d.vessel.from : '',
    vesselTo: d.vessel ? d.vessel.to : '',
    vesselPosition: d.vessel ? d.vessel.position : '',
    vesselEta: d.vessel ? d.vessel.eta : '',
    vesselAfterPort: d.vessel ? d.vessel.afterPort : '',
    vesselUpdated: d.vessel ? d.vessel.updated : '',
    vesselSource: d.vessel ? d.vessel.source : '',
    // A decision carried over from the previous workbook wins over the JSON, which only
    // ever says "pending".
    ...(kept.decisions.get(String(d.id)) || {
      status: d.status,
      decidedBy: '',
      decidedAt: '',
      decisionNote: ''
    })
  }));

  const itemRows = [];
  for (const d of documentsFile.documents) {
    for (const item of d.items || []) itemRows.push({ documentId: d.id, ...item });
  }

  // --- Supplier history: keyed object in, flat table out --------------------
  const historyRows = [];
  for (const [supplierId, orders] of Object.entries(historyFile.history)) {
    for (const order of orders) historyRows.push({ supplierId, ...order });
  }

  // --- Materials and their departmental demand ------------------------------
  const materialRows = stockFile.materials.map((m) => ({
    code: m.code,
    name: m.name,
    plant: m.plant,
    onHand: m.onHand,
    unit: m.unit,
    safetyStock: m.safetyStock,
    reorderPoint: m.reorderPoint,
    // A request raised from the dashboard added to this, so keep the larger of the two.
    openOrderQuantity: Math.max(m.openOrderQuantity, kept.onOrder.get(`${m.code}@${m.plant}`) ?? 0),
    dailyUsage: m.dailyUsage,
    leadTimeDays: m.leadTimeDays,
    kiln: m.kiln,
    supplierName: m.supplierName
  }));

  const needRows = [];
  for (const m of stockFile.materials) {
    for (const need of m.needs || []) {
      needRows.push({ materialCode: m.code, plant: m.plant, ...need });
    }
  }

  // --- Situations: the joined list has to live in one cell ------------------
  const situationRows = situationsFile.situations.map((s) => ({
    ...s,
    joined: (s.joined || []).join(LIST_SEPARATOR),
    status: kept.situations.get(String(s.id)) || s.status
  }));

  addSheet(workbook, SHEETS.documents, COLUMNS.documents, documentRows, 'FFE3F3FA');
  addSheet(workbook, SHEETS.orderItems, COLUMNS.orderItems, itemRows, 'FFE3F3FA');
  addSheet(workbook, SHEETS.suppliers, COLUMNS.suppliers, suppliersFile.suppliers);
  addSheet(workbook, SHEETS.supplierHistory, COLUMNS.supplierHistory, historyRows);
  addSheet(workbook, SHEETS.materials, COLUMNS.materials, materialRows, 'FFE1F3EE');
  addSheet(workbook, SHEETS.materialNeeds, COLUMNS.materialNeeds, needRows, 'FFE1F3EE');
  addSheet(workbook, SHEETS.situations, COLUMNS.situations, situationRows, 'FFFBE8E9');
  addSheet(workbook, SHEETS.openOrders, COLUMNS.openOrders, commitmentsFile.openOrders, 'FFFAEFE0');
  addSheet(workbook, SHEETS.openRequests, COLUMNS.openRequests, commitmentsFile.openRequests, 'FFFAEFE0');
  addSheet(workbook, SHEETS.contracts, COLUMNS.contracts, commitmentsFile.contracts, 'FFFAEFE0');
  addSheet(workbook, SHEETS.teams, COLUMNS.teams, teamsFile.teams);

  // Starts empty on a first build. Every decision appends a row here, and --refresh puts
  // the existing rows back.
  addSheet(workbook, SHEETS.actionLog, COLUMNS.actionLog, kept.actionLog);

  await workbook.xlsx.writeFile(WORKBOOK_PATH);

  console.log('');
  console.log(`${refresh ? 'Refreshed' : 'Created'} ${WORKBOOK_PATH}`);
  if (refresh) {
    console.log(
      `  kept ${kept.decisions.size} decisions, ${kept.situations.size} fixed problems, ` +
        `${kept.actionLog.length} action log entries`
    );
  }
  console.log('');
  for (const sheet of workbook.worksheets) {
    console.log(`  ${sheet.name.padEnd(20)} ${Math.max(0, sheet.rowCount - 1)} rows`);
  }
  console.log('');
}

main().catch((error) => {
  console.error('Could not build the workbook:', error.message);
  process.exit(1);
});
