// Creates server/data/procurement.xlsx from the JSON files.
//
// Run it once to get a starting workbook:
//   node server/scripts/build-workbook.js
//
// After that the workbook is the real data. Editing it in Excel changes what the
// dashboard shows, and approving something in the dashboard writes back into it.
//
// It will not overwrite an existing workbook unless you pass --force, because that
// workbook may contain approvals you have made since. This is the sort of guard worth
// writing on day one: the day you need it, you REALLY need it.

import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKBOOK_PATH, SHEETS, COLUMNS } from '../src/excel-schema.js';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const dataFolder = path.resolve(thisFolder, '../data');

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(dataFolder, name), 'utf8'));
}

// Adds one sheet, writes the header row, then the data rows. Header styling is not
// decoration: a frozen bold header is what makes a 200-row sheet usable in Excel.
function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;

  for (const row of rows) sheet.addRow(row);

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEEF2F7' }
  };
  // Keeps the header visible while scrolling.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  // Turns on the filter dropdowns, so you can sort and filter without setting it up.
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length }
  };
  return sheet;
}

async function main() {
  const force = process.argv.includes('--force');

  try {
    await fs.access(WORKBOOK_PATH);
    if (!force) {
      console.error('');
      console.error(`The workbook already exists: ${WORKBOOK_PATH}`);
      console.error('Refusing to overwrite it, because it may hold approvals you have made.');
      console.error('If you really want to start again from the JSON files, run:');
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

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Procurement Dashboard';
  workbook.created = new Date();

  addSheet(workbook, SHEETS.documents, COLUMNS.documents, documentsFile.documents);
  addSheet(workbook, SHEETS.suppliers, COLUMNS.suppliers, suppliersFile.suppliers);

  // The history JSON is keyed by supplier. A spreadsheet wants one flat table, so the
  // supplier id becomes a column on every row.
  const historyRows = [];
  for (const [supplierId, orders] of Object.entries(historyFile.history)) {
    for (const order of orders) historyRows.push({ supplierId, ...order });
  }
  addSheet(workbook, SHEETS.supplierHistory, COLUMNS.supplierHistory, historyRows);

  addSheet(workbook, SHEETS.materials, COLUMNS.materials, stockFile.materials);
  addSheet(workbook, SHEETS.situations, COLUMNS.situations, situationsFile.situations);

  // Starts empty. Every approval and rejection appends a row here.
  addSheet(workbook, SHEETS.actionLog, COLUMNS.actionLog, []);

  await workbook.xlsx.writeFile(WORKBOOK_PATH);

  console.log('');
  console.log(`Created ${WORKBOOK_PATH}`);
  console.log('');
  console.log('Sheets:');
  console.log(`  ${SHEETS.documents.padEnd(18)} ${documentsFile.documents.length} rows`);
  console.log(`  ${SHEETS.suppliers.padEnd(18)} ${suppliersFile.suppliers.length} rows`);
  console.log(`  ${SHEETS.supplierHistory.padEnd(18)} ${historyRows.length} rows`);
  console.log(`  ${SHEETS.materials.padEnd(18)} ${stockFile.materials.length} rows`);
  console.log(`  ${SHEETS.situations.padEnd(18)} ${situationsFile.situations.length} rows`);
  console.log(`  ${SHEETS.actionLog.padEnd(18)} 0 rows (fills up as you approve things)`);
  console.log('');
  console.log('Set DATA_SOURCE=excel in .env to use it.');
  console.log('');
}

main().catch((error) => {
  console.error('Could not build the workbook:', error.message);
  process.exit(1);
});
