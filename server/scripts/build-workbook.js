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

async function main() {
  const force = process.argv.includes('--force');

  try {
    await fs.access(WORKBOOK_PATH);
    if (!force) {
      console.error('');
      console.error(`The workbook already exists: ${WORKBOOK_PATH}`);
      console.error('Refusing to overwrite it, because it may hold decisions you have made.');
      console.error('To start again from the JSON files, run:');
      console.error('  node server/scripts/build-workbook.js --force');
      console.error('');
      process.exit(1);
    }
  } catch {
    // Does not exist yet, which is the normal first run.
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
    prevName: d.prev ? d.prev.name : '',
    prevLevel: d.prev ? d.prev.level : '',
    prevWhen: d.prev ? d.prev.when : '',
    prevNote: d.prev ? d.prev.note : '',
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
    status: d.status,
    decidedBy: '',
    decidedAt: '',
    decisionNote: ''
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
    openOrderQuantity: m.openOrderQuantity,
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
    joined: (s.joined || []).join(LIST_SEPARATOR)
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

  // Starts empty. Every decision appends a row here.
  addSheet(workbook, SHEETS.actionLog, COLUMNS.actionLog, []);

  await workbook.xlsx.writeFile(WORKBOOK_PATH);

  console.log('');
  console.log(`Created ${WORKBOOK_PATH}`);
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
