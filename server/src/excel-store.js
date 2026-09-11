// Reading from and writing to the Excel workbook.
//
// Four problems are solved here, and they are the reason this file exists rather than the
// provider calling ExcelJS directly.
//
// 1. Reading the whole workbook on every request would be slow. It is read once and kept
//    in memory, re-read only when the file on disk has actually changed. That also means
//    you can edit the workbook in Excel and see it without restarting anything.
//
// 2. Excel locks the file while it is open. On Windows, writing to a workbook you have
//    open fails with EBUSY. That is not a bug we can fix, so it becomes a clear message
//    telling you to close it, not a crash.
//
// 3. A crash halfway through writing would leave a corrupt workbook and lose everything.
//    Writes go to a temporary file first and only replace the real one once complete.
//
// 4. Spreadsheets are flat, but an order has item lines and a material has departmental
//    demand. Those live in their own sheets and are reassembled here, so nothing above
//    this layer has to know the data was ever flattened.

import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import { WORKBOOK_PATH, SHEETS, COLUMNS, LIST_SEPARATOR } from './excel-schema.js';

let cache = null;
let cachedAt = 0;

// Excel cells are not always plain values. A formula cell arrives as an object, and a cell
// holding an email address arrives as a hyperlink. This flattens whatever ExcelJS gives
// back to something JavaScript can work with.
function cellValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'object') {
    if ('result' in raw) return raw.result;
    if ('text' in raw) return raw.text;
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

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Turns one sheet into an array of plain objects, using the column keys from the schema.
// Rows are matched by HEADER TEXT, not by position, so reordering columns in Excel does
// not silently shift every value into the wrong field.
function readSheet(workbook, sheetName, columns, { optional = false } = {}) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    if (optional) return [];
    throw new Error(
      `The workbook has no sheet called "${sheetName}". ` +
        `Rebuild it with: node server/scripts/build-workbook.js --force`
    );
  }

  const keyByColumn = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const header = asText(cellValue(cell.value));
    const column = columns.find((c) => c.header === header);
    if (column) keyByColumn.set(columnNumber, column.key);
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

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

// --- Reassembling the nested shapes -----------------------------------------

function buildDocuments(documentRows, itemRows) {
  // Group item lines by their document, so each header can be handed its own list.
  const itemsByDocument = new Map();
  for (const row of itemRows) {
    const id = asText(row.documentId);
    if (!itemsByDocument.has(id)) itemsByDocument.set(id, []);
    itemsByDocument.get(id).push({
      pos: asNumber(row.pos) ?? 10,
      materialCode: asText(row.materialCode),
      material: asText(row.material),
      type: asText(row.type),
      typeText: asText(row.typeText),
      group: asText(row.group),
      groupText: asText(row.groupText),
      quantity: asNumber(row.quantity) ?? 0,
      unit: asText(row.unit),
      rate: asNumber(row.rate) ?? 0
    });
  }

  return documentRows.map((row) => {
    const id = asText(row.id);
    const items = (itemsByDocument.get(id) || []).sort((a, b) => a.pos - b.pos);

    return {
      id,
      kind: asText(row.kind) || 'PO',
      docType: asText(row.docType),
      trade: asText(row.trade),
      incoterm: asText(row.incoterm),
      supplierId: asText(row.supplierId),
      material: asText(row.material),
      materialCode: asText(row.materialCode),
      plant: asText(row.plant),
      quantity: asNumber(row.quantity) ?? 0,
      unit: asText(row.unit),
      rate: asNumber(row.rate) ?? 0,
      basic: asNumber(row.basic) ?? 0,
      freight: asNumber(row.freight) ?? 0,
      loading: asNumber(row.loading) ?? 0,
      transport: asText(row.transport),
      payTerms: asText(row.payTerms),
      cashDiscount: asText(row.cashDiscount),
      rebate: asText(row.rebate),
      deliveryDate: asText(row.deliveryDate),
      hoursWaiting: asNumber(row.hoursWaiting) ?? 0,
      step: asText(row.step),
      sourceDocument: asText(row.sourceDocument),
      shipmentStage: asText(row.shipmentStage),
      shipmentStageAt: asText(row.shipmentStageAt),
      shipmentNote: asText(row.shipmentNote),
      reason: asText(row.reason),
      items,
      // Who raised it. Null rather than an empty object, so the mailer can ask "is there
      // anyone to tell?" with a plain if.
      createdBy: asText(row.createdByName)
        ? {
            name: asText(row.createdByName),
            title: asText(row.createdByTitle),
            when: asText(row.createdByWhen)
          }
        : null,
      // Only build the previous-approver block when there actually was one.
      prev: asText(row.prevName)
        ? {
            name: asText(row.prevName),
            level: asText(row.prevLevel),
            when: asText(row.prevWhen),
            note: asText(row.prevNote)
          }
        : null,
      // An empty "Goes next to" is meaningful: it says this approval finishes the
      // document. That is why the column stays blank rather than repeating the approver.
      next: asText(row.nextName)
        ? {
            name: asText(row.nextName),
            title: asText(row.nextTitle),
            level: asText(row.nextLevel)
          }
        : null,
      // Same for the ship. Only import orders have one.
      vessel: asText(row.vesselName)
        ? {
            name: asText(row.vesselName),
            imo: asText(row.vesselImo),
            billOfLading: asText(row.vesselBillOfLading),
            from: asText(row.vesselFrom),
            to: asText(row.vesselTo),
            position: asText(row.vesselPosition),
            eta: asText(row.vesselEta),
            afterPort: asText(row.vesselAfterPort),
            updated: asText(row.vesselUpdated),
            source: asText(row.vesselSource)
          }
        : null,
      status: (asText(row.status) || 'pending').toLowerCase(),
      decidedBy: asText(row.decidedBy),
      decidedAt: asText(row.decidedAt),
      decisionNote: asText(row.decisionNote)
    };
  });
}

function buildMaterials(materialRows, needRows) {
  // Demand is keyed by material AND plant: the same material exists at several plants
  // with different demand, and keying on the code alone would merge them.
  const needsByKey = new Map();
  for (const row of needRows) {
    const key = `${asText(row.materialCode)}@${asText(row.plant)}`;
    if (!needsByKey.has(key)) needsByKey.set(key, []);
    needsByKey.get(key).push({
      dept: asText(row.dept),
      quantity: asNumber(row.quantity) ?? 0,
      by: asText(row.by),
      who: asText(row.who)
    });
  }

  return materialRows.map((row) => {
    const code = asText(row.code);
    const plant = asText(row.plant);
    return {
      code,
      name: asText(row.name),
      plant,
      onHand: asNumber(row.onHand) ?? 0,
      unit: asText(row.unit),
      safetyStock: asNumber(row.safetyStock) ?? 0,
      reorderPoint: asNumber(row.reorderPoint) ?? 0,
      openOrderQuantity: asNumber(row.openOrderQuantity) ?? 0,
      dailyUsage: asNumber(row.dailyUsage) ?? 0,
      leadTimeDays: asNumber(row.leadTimeDays) ?? 0,
      kiln: asBoolean(row.kiln),
      supplierName: asText(row.supplierName),
      needs: needsByKey.get(`${code}@${plant}`) || []
    };
  });
}

// --- Loading ----------------------------------------------------------------

async function fileChangedSinceCache() {
  try {
    const stat = await fs.stat(WORKBOOK_PATH);
    return stat.mtimeMs !== cachedAt;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('The workbook is missing. Create it with: node server/scripts/build-workbook.js');
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
      throw new Error('The workbook is missing. Create it with: node server/scripts/build-workbook.js');
    }
    throw new Error(
      `Could not read the workbook. If it is open in Excel, close it and try again. (${error.message})`
    );
  }

  const stat = await fs.stat(WORKBOOK_PATH);

  cache = {
    documents: buildDocuments(
      readSheet(workbook, SHEETS.documents, COLUMNS.documents),
      readSheet(workbook, SHEETS.orderItems, COLUMNS.orderItems, { optional: true })
    ),
    suppliers: readSheet(workbook, SHEETS.suppliers, COLUMNS.suppliers).map((row) => ({
      id: asText(row.id),
      name: asText(row.name),
      category: asText(row.category),
      city: asText(row.city),
      gst: asText(row.gst),
      iec: asText(row.iec) || null,
      sapScore: asNumber(row.sapScore) ?? 0,
      contractRate: asNumber(row.contractRate) ?? 0,
      unit: asText(row.unit)
    })),
    supplierHistory: readSheet(workbook, SHEETS.supplierHistory, COLUMNS.supplierHistory).map((row) => ({
      supplierId: asText(row.supplierId),
      order: asText(row.order),
      month: asText(row.month),
      daysLate: asNumber(row.daysLate) ?? 0,
      qualityPercent: asNumber(row.qualityPercent) ?? 0,
      rate: asNumber(row.rate) ?? 0
    })),
    materials: buildMaterials(
      readSheet(workbook, SHEETS.materials, COLUMNS.materials),
      readSheet(workbook, SHEETS.materialNeeds, COLUMNS.materialNeeds, { optional: true })
    ),
    situations: readSheet(workbook, SHEETS.situations, COLUMNS.situations).map((row) => ({
      ...row,
      id: asText(row.id),
      canAutoFix: asBoolean(row.canAutoFix),
      // The list was stored in one cell. Split it back out.
      joined: asText(row.joined) ? asText(row.joined).split(LIST_SEPARATOR).map((s) => s.trim()) : [],
      status: (asText(row.status) || 'open').toLowerCase()
    })),
    openOrders: readSheet(workbook, SHEETS.openOrders, COLUMNS.openOrders, { optional: true }).map((row) => ({
      ...row,
      id: asText(row.id),
      value: asNumber(row.value) ?? 0,
      receivedPercent: asNumber(row.receivedPercent) ?? 0
    })),
    openRequests: readSheet(workbook, SHEETS.openRequests, COLUMNS.openRequests, { optional: true }).map((row) => ({
      ...row,
      id: asText(row.id),
      value: asNumber(row.value) ?? 0,
      ageDays: asNumber(row.ageDays) ?? 0
    })),
    contracts: readSheet(workbook, SHEETS.contracts, COLUMNS.contracts, { optional: true }).map((row) => ({
      ...row,
      id: asText(row.id),
      target: asNumber(row.target) ?? 0,
      used: asNumber(row.used) ?? 0,
      daysLeft: asNumber(row.daysLeft) ?? 0
    })),
    teams: readSheet(workbook, SHEETS.teams, COLUMNS.teams, { optional: true }).map((row) => ({
      ...row,
      id: asText(row.id),
      people: asNumber(row.people) ?? 0,
      tasks: asNumber(row.tasks) ?? 0,
      done: asNumber(row.done) ?? 0,
      mailsWaiting: asNumber(row.mailsWaiting) ?? 0
    }))
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

// Finds the row for one record on one sheet and updates the given fields.
async function updateRow(sheetName, columns, idKey, idValue, updates, purpose) {
  const workbook = await openWorkbook(purpose);

  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`The workbook has no "${sheetName}" sheet.`);

  // Work out which spreadsheet column each field lives in, by header text, creating any
  // the file does not have yet.
  //
  // Creating them matters: this used to skip a field whose header was missing, so writing
  // a newly added column to an older workbook did nothing at all and said nothing about
  // it. A save that reports success and stores nothing is the worst kind of bug here,
  // because the thing it loses is a decision somebody made.
  const columnByKey = columnPositions(sheet, columns, { create: true });

  const idColumn = columnByKey.get(idKey);
  if (!idColumn) throw new Error(`The "${sheetName}" sheet has no column for ${idKey}.`);

  let targetRow = null;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || targetRow) return;
    if (asText(cellValue(row.getCell(idColumn).value)) === String(idValue)) targetRow = row;
  });

  if (!targetRow) throw new Error(`${idValue} is not in the ${sheetName} sheet.`);

  for (const [key, value] of Object.entries(updates)) {
    const columnNumber = columnByKey.get(key);
    if (columnNumber) targetRow.getCell(columnNumber).value = value;
  }

  await writeSafely(workbook);
  invalidateCache();
}

// Records a decision on one document.
//
// Separate from appendActionLog on purpose: the decision must be saved before the email is
// attempted, but the log entry cannot be written until we know whether the email went.
export async function updateDocument(documentId, updates) {
  return updateRow(SHEETS.documents, COLUMNS.documents, 'id', documentId, updates, 'save your decision');
}

// Marks a problem as handled.
export async function updateSituation(situationId, updates) {
  return updateRow(SHEETS.situations, COLUMNS.situations, 'id', situationId, updates, 'update the problem');
}

// Changes the quantity already on order for a material, used when a request is raised.
export async function updateMaterial(materialCode, plant, updates) {
  const workbook = await openWorkbook('update the material');

  const sheet = workbook.getWorksheet(SHEETS.materials);
  if (!sheet) throw new Error(`The workbook has no "${SHEETS.materials}" sheet.`);

  const columnByKey = new Map();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const header = asText(cellValue(cell.value));
    const column = COLUMNS.materials.find((c) => c.header === header);
    if (column) columnByKey.set(column.key, columnNumber);
  });

  // Material code alone is not unique; the same material exists at several plants.
  const codeColumn = columnByKey.get('code');
  const plantColumn = columnByKey.get('plant');

  let targetRow = null;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || targetRow) return;
    const sameCode = asText(cellValue(row.getCell(codeColumn).value)) === String(materialCode);
    const samePlant = asText(cellValue(row.getCell(plantColumn).value)) === String(plant);
    if (sameCode && samePlant) targetRow = row;
  });

  if (!targetRow) throw new Error(`${materialCode} at ${plant} is not in the workbook.`);

  for (const [key, value] of Object.entries(updates)) {
    const columnNumber = columnByKey.get(key);
    if (columnNumber) targetRow.getCell(columnNumber).value = value;
  }

  await writeSafely(workbook);
  invalidateCache();
}

// Appends one row to the audit trail. One row per action, written once the outcome is
// known, so the log never contains a half-finished entry.
export async function appendActionLog(entry) {
  const workbook = await openWorkbook('write the action log');

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

// Writes one row, matching values to the sheet's OWN header order rather than to the order
// the schema happens to list them in.
//
// addRow() writes positionally, so a schema that has gained a column since the file was
// built would put every later value one cell to the left - a corruption that reads back as
// plausible nonsense. Matching on the header makes the two independent, and any header the
// file is missing is appended first, so an older workbook gains the column on first write
// instead of needing a rebuild.
// Where each field lives in this sheet, worked out from the header row.
//
// With `create`, any header the file is missing is appended rather than skipped. That is
// what lets a workbook built before a column existed gain it on first write instead of
// needing a rebuild - and, more importantly, it is what stops a new field being written
// to a column that is not there and vanishing without a word.
function columnPositions(sheet, columns, { create = false } = {}) {
  const headerRow = sheet.getRow(1);
  const columnByKey = new Map();

  headerRow.eachCell((cell, columnNumber) => {
    const header = asText(cellValue(cell.value));
    const column = columns.find((c) => c.header === header);
    if (column) columnByKey.set(column.key, columnNumber);
  });

  if (!create) return columnByKey;

  let width = Math.max(sheet.columnCount, headerRow.cellCount);
  for (const column of columns) {
    if (columnByKey.has(column.key)) continue;
    width += 1;
    headerRow.getCell(width).value = column.header;
    headerRow.getCell(width).font = { bold: true };
    sheet.getColumn(width).width = column.width || 16;
    columnByKey.set(column.key, width);
  }
  headerRow.commit();

  return columnByKey;
}

// Appends one row, matching values to the sheet OWN header order rather than to the order
// the schema happens to list them in.
//
// addRow() writes positionally, so a schema that has gained a column since the file was
// built would put every later value one cell to the left - a corruption that reads back
// as plausible nonsense.
function writeRow(sheet, columns, values) {
  const columnByKey = columnPositions(sheet, columns, { create: true });

  const row = sheet.getRow(sheet.rowCount + 1);
  for (const column of columns) {
    const value = values[column.key];
    row.getCell(columnByKey.get(column.key)).value = value === undefined || value === null ? '' : value;
  }
  row.commit();
}

// Adds a brand new document to the workbook: the header, its one item line, and - for a
// requisition - the row that makes it show up as an open request.
//
// Three sheets rather than one, because that is where the dashboard reads each piece from.
// A header alone would appear in the approval list and nowhere else, which is exactly the
// half-written state that made a raised request look saved when it was not.
//
// The sheets are written in one pass and saved once. A spreadsheet has no transactions, so
// the alternative is three saves and three chances to stop halfway.
export async function appendDocument({ document, item, openRequest }) {
  const workbook = await openWorkbook('add a document');

  const sheet = workbook.getWorksheet(SHEETS.documents);
  if (!sheet) throw new Error(`The workbook has no ${SHEETS.documents} sheet.`);

  // Refuse a number that is already in use. Two documents sharing one would make every
  // later approval ambiguous, and the workbook has no unique constraint to catch it.
  const existing = readSheet(workbook, SHEETS.documents, COLUMNS.documents);
  if (existing.some((row) => asText(row.id) === String(document.id))) {
    throw new Error(`Document ${document.id} already exists in the workbook.`);
  }

  writeRow(sheet, COLUMNS.documents, document);

  if (item) {
    let itemSheet = workbook.getWorksheet(SHEETS.orderItems);
    if (!itemSheet) {
      itemSheet = workbook.addWorksheet(SHEETS.orderItems);
      itemSheet.columns = COLUMNS.orderItems;
      itemSheet.getRow(1).font = { bold: true };
    }
    itemSheet.addRow(COLUMNS.orderItems.map((c) => item[c.key] ?? ''));
  }

  if (openRequest) {
    let requestSheet = workbook.getWorksheet(SHEETS.openRequests);
    if (!requestSheet) {
      requestSheet = workbook.addWorksheet(SHEETS.openRequests);
      requestSheet.columns = COLUMNS.openRequests;
      requestSheet.getRow(1).font = { bold: true };
    }
    requestSheet.addRow(COLUMNS.openRequests.map((c) => openRequest[c.key] ?? ''));
  }

  await writeSafely(workbook);
  invalidateCache();
}

// Every document number already in the workbook, so a new one can be given the next in the
// series without colliding with a seeded row.
export async function allDocumentIds() {
  const data = await loadWorkbook();
  return data.documents.map((d) => d.id);
}

// Reads the audit trail back, newest first.
export async function readActionLog() {
  const workbook = await openWorkbook('read the action log');
  return readSheet(workbook, SHEETS.actionLog, COLUMNS.actionLog, { optional: true }).reverse();
}

// Writes to a temporary file, then renames it over the real one. A rename is atomic on the
// same drive, so a crash mid-write leaves the original workbook untouched rather than
// half-written and unopenable.
async function writeSafely(workbook) {
  const tempPath = `${WORKBOOK_PATH}.tmp`;
  try {
    await workbook.xlsx.writeFile(tempPath);
    await fs.rename(tempPath, WORKBOOK_PATH);
  } catch (error) {
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
