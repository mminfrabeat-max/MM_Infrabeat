// Reading from and writing to the Excel workbook.
//
// Three problems have to be solved here, and they are the reason this file exists rather
// than the provider just calling ExcelJS directly.
//
// 1. Reading the whole workbook on every request would be slow. So it is read once and
//    kept in memory, and re-read only when the file on disk has actually changed. That
//    also means you can edit the workbook in Excel and see it in the dashboard without
//    restarting anything.
//
// 2. Excel locks the file while it is open. On Windows, writing to a workbook you have
//    open in Excel fails with EBUSY. That is not a bug we can fix, so it has to become a
//    clear message telling you to close it, not a crash.
//
// 3. A crash halfway through writing would leave a corrupt workbook and lose everything.
//    So writes go to a temporary file first and only replace the real one once complete.

import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import { WORKBOOK_PATH, SHEETS, COLUMNS } from './excel-schema.js';

// What we last read, and the file timestamp it came from.
let cache = null;
let cachedAt = 0;

// Excel cells are not always plain values. A formula cell arrives as an object, and a
// cell holding an email address arrives as a hyperlink object. This flattens whatever
// ExcelJS gives us back to something JavaScript can work with.
function cellValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'object') {
    if ('result' in raw) return raw.result;      // formula: use the calculated value
    if ('text' in raw) return raw.text;          // hyperlink or rich text
    if ('richText' in raw) return raw.richText.map((p) => p.text).join('');
  }
  return raw;
}

// Excel has no real boolean column, so TRUE/true/yes/1 all have to mean the same thing.
function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === '1';
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Turns one sheet into an array of plain objects, using the column keys from the schema.
// Rows are matched by HEADER TEXT, not by position, so someone reordering columns in
// Excel does not silently shift every value into the wrong field.
function readSheet(workbook, sheetName, columns) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    throw new Error(
      `The workbook has no sheet called "${sheetName}". ` +
        `Rebuild it with: node server/scripts/build-workbook.js --force`
    );
  }

  // Map each header we find to the field name it belongs to.
  const headerRow = sheet.getRow(1);
  const keyByColumn = new Map();
  headerRow.eachCell((cell, columnNumber) => {
    const header = String(cellValue(cell.value) ?? '').trim();
    const column = columns.find((c) => c.header === header);
    if (column) keyByColumn.set(columnNumber, column.key);
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // the header

    const record = {};
    let hasAnyValue = false;

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const key = keyByColumn.get(columnNumber);
      if (!key) return;
      const value = cellValue(cell.value);
      record[key] = value;
      if (value !== null && value !== undefined && value !== '') hasAnyValue = true;
    });

    // Skip blank rows. Excel files collect these at the bottom very easily.
    if (hasAnyValue) rows.push(record);
  });

  return rows;
}

// --- Type fixing ------------------------------------------------------------
// Everything above returns whatever Excel happened to store. The rest of the backend
// expects numbers to be numbers. These functions are where that is guaranteed, once,
// rather than being defended against in twenty places later.

function fixDocument(row) {
  return {
    ...row,
    quantity: asNumber(row.quantity) ?? 0,
    rate: asNumber(row.rate) ?? 0,
    contractRate: asNumber(row.contractRate),
    value: asNumber(row.value) ?? 0,
    hoursWaiting: asNumber(row.hoursWaiting) ?? 0,
    status: String(row.status || 'pending').trim().toLowerCase()
  };
}

function fixSupplier(row) {
  return { ...row, contractRate: asNumber(row.contractRate) ?? 0 };
}

function fixHistory(row) {
  return {
    ...row,
    daysLate: asNumber(row.daysLate) ?? 0,
    qualityPercent: asNumber(row.qualityPercent) ?? 0,
    rate: asNumber(row.rate) ?? 0,
    value: asNumber(row.value) ?? 0
  };
}

function fixMaterial(row) {
  return {
    ...row,
    onHand: asNumber(row.onHand) ?? 0,
    safetyStock: asNumber(row.safetyStock) ?? 0,
    reorderPoint: asNumber(row.reorderPoint) ?? 0,
    openOrderQuantity: asNumber(row.openOrderQuantity) ?? 0,
    dailyUsage: asNumber(row.dailyUsage) ?? 0,
    leadTimeDays: asNumber(row.leadTimeDays) ?? 0
  };
}

function fixSituation(row) {
  return { ...row, canAutoFix: asBoolean(row.canAutoFix) };
}

// --- Loading ----------------------------------------------------------------

async function fileChangedSinceCache() {
  try {
    const stat = await fs.stat(WORKBOOK_PATH);
    return stat.mtimeMs !== cachedAt;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `The workbook is missing. Create it with: node server/scripts/build-workbook.js`
      );
    }
    throw error;
  }
}

export async function loadWorkbook() {
  if (cache && !(await fileChangedSinceCache())) return cache;

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.readFile(WORKBOOK_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'The workbook is missing. Create it with: node server/scripts/build-workbook.js'
      );
    }
    throw new Error(
      `Could not read the workbook. If it is open in Excel, close it and try again. (${error.message})`
    );
  }

  const stat = await fs.stat(WORKBOOK_PATH);

  cache = {
    documents: readSheet(workbook, SHEETS.documents, COLUMNS.documents).map(fixDocument),
    suppliers: readSheet(workbook, SHEETS.suppliers, COLUMNS.suppliers).map(fixSupplier),
    supplierHistory: readSheet(workbook, SHEETS.supplierHistory, COLUMNS.supplierHistory).map(fixHistory),
    materials: readSheet(workbook, SHEETS.materials, COLUMNS.materials).map(fixMaterial),
    situations: readSheet(workbook, SHEETS.situations, COLUMNS.situations).map(fixSituation)
  };
  cachedAt = stat.mtimeMs;

  return cache;
}

// Forces the next read to come from disk. Called after we write, so our own change is
// picked up immediately rather than on the next timestamp check.
export function invalidateCache() {
  cache = null;
  cachedAt = 0;
}

// --- Writing ----------------------------------------------------------------

async function openWorkbook(purpose) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(WORKBOOK_PATH);
  } catch (error) {
    throw new Error(`Could not open the workbook to ${purpose}. ${lockHint(error)}`);
  }
  return workbook;
}

// Updates the decision fields on one document row.
//
// This is separate from appendActionLog on purpose. The decision has to be saved before
// the email is attempted, but the log entry cannot be written until we know whether the
// email actually went. Two functions, called at two different moments.
export async function updateDocument(documentId, updates) {
  const workbook = await openWorkbook('save your decision');

  const sheet = workbook.getWorksheet(SHEETS.documents);
  if (!sheet) throw new Error(`The workbook has no "${SHEETS.documents}" sheet.`);

  // Work out which spreadsheet column each field lives in, by header text.
  const columnByKey = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const header = String(cellValue(cell.value) ?? '').trim();
    const column = COLUMNS.documents.find((c) => c.header === header);
    if (column) columnByKey.set(column.key, columnNumber);
  });

  const idColumn = columnByKey.get('id');
  if (!idColumn) throw new Error('The workbook has no "Document number" column.');

  let targetRow = null;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || targetRow) return;
    const id = String(cellValue(row.getCell(idColumn).value) ?? '').trim();
    if (id === String(documentId)) targetRow = row;
  });

  if (!targetRow) {
    throw new Error(`Document ${documentId} is not in the workbook.`);
  }

  for (const [key, value] of Object.entries(updates)) {
    const columnNumber = columnByKey.get(key);
    if (columnNumber) targetRow.getCell(columnNumber).value = value;
  }

  await writeSafely(workbook);
  invalidateCache();
}

// Appends one row to the audit trail. One row per decision, written once we know how the
// email went, so the log never contains a half-finished entry.
export async function appendActionLog(entry) {
  const workbook = await openWorkbook('write the action log');

  // Created on the fly if somebody deleted the sheet in Excel.
  let logSheet = workbook.getWorksheet(SHEETS.actionLog);
  if (!logSheet) {
    logSheet = workbook.addWorksheet(SHEETS.actionLog);
    logSheet.columns = COLUMNS.actionLog;
    logSheet.getRow(1).font = { bold: true };
  }

  logSheet.addRow(COLUMNS.actionLog.map((c) => entry[c.key] ?? ''));

  await writeSafely(workbook);
  invalidateCache();
}

// Reads the audit trail back, newest first, so the dashboard can show what has been done.
export async function readActionLog() {
  const workbook = await openWorkbook('read the action log');
  const sheet = workbook.getWorksheet(SHEETS.actionLog);
  if (!sheet) return [];

  const columnByNumber = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const header = String(cellValue(cell.value) ?? '').trim();
    const column = COLUMNS.actionLog.find((c) => c.header === header);
    if (column) columnByNumber.set(columnNumber, column.key);
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const key = columnByNumber.get(columnNumber);
      if (!key) return;
      const value = cellValue(cell.value);
      record[key] = value;
      if (value !== null && value !== undefined && value !== '') hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return rows.reverse();
}

// Writes to a temporary file, then renames it over the real one. A rename is atomic on
// the same drive, so a crash mid-write leaves the original workbook untouched rather
// than half-written and unopenable.
async function writeSafely(workbook) {
  const tempPath = `${WORKBOOK_PATH}.tmp`;

  try {
    await workbook.xlsx.writeFile(tempPath);
    await fs.rename(tempPath, WORKBOOK_PATH);
  } catch (error) {
    // Clean up the temp file so failures do not litter the data folder.
    await fs.unlink(tempPath).catch(() => {});
    throw new Error(`Could not save the workbook. ${lockHint(error)}`);
  }
}

// Windows reports a file open in Excel as EBUSY or EPERM. Neither means anything to a
// person, so translate it into the actual instruction.
function lockHint(error) {
  if (error.code === 'EBUSY' || error.code === 'EPERM') {
    return 'The file is open in Excel. Close it and try again.';
  }
  return error.message;
}
