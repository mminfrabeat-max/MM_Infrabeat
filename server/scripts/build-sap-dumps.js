// Creates server/data/sap-source-tables.xlsx: the same demo data, but shaped exactly the
// way SAP would hand it over.
//
//   node server/scripts/build-sap-dumps.js
//
// Why this file exists. The dashboard works in business language: "supplier name",
// "days of cover". SAP works in its own: "Supplier", "ReorderThresholdQuantity". At some
// point somebody has to translate between the two, and that job is milestone 4.
//
// This workbook is the specification for that job. It says, per entity, exactly which
// SAP fields the dashboard needs and what our business field is called. Two uses:
//
//   1. Hand it to whoever runs your SAP system. They can produce a real extract in this
//      shape without needing to understand the dashboard at all.
//   2. Use it to write SapProvider, since every mapping it has to perform is listed.
//
// FIELD NAMES. Every SAP field name below is one I have either verified or am confident
// about, and the ReadMe sheet marks the handful worth checking yourself. The rule we
// agreed holds: no invented field names. Check any of them at
// https://api.sap.com -> the API -> API Reference, or by fetching $metadata from the
// service, which is the definitive list for the release you are on.
//
// VALUES are demo data. Company codes, plant codes and supplier numbers below are
// invented to look like SAP's, because a real extract would have your own.

import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const dataFolder = path.resolve(thisFolder, '../data');
const OUTPUT = path.join(dataFolder, 'sap-source-tables.xlsx');

// --- Demo codes -------------------------------------------------------------
// Our data uses readable names. SAP uses codes. These tables are the bridge, and they
// are the sort of thing a real project spends a surprising amount of time agreeing.

const PLANT_CODE = { Durg: '1010', Sirohi: '1020', Kalol: '1030' };
const COMPANY_CODE = '1000';
const PURCHASING_ORG = '1000';
const PURCHASING_GROUP = '001';
const CURRENCY = 'INR';

// SAP supplier numbers are ten characters, zero padded. V-10024 becomes 0000100024.
function sapSupplier(supplierId) {
  if (!supplierId) return '';
  const digits = String(supplierId).replace(/\D/g, '');
  return digits.padStart(10, '0');
}

// Our "22 Sep 2026" is for people. SAP wants a real date. ISO here, because a dump read
// by another system should never be ambiguous about whether 03-04 is March or April.
function isoDate(text) {
  if (!text || text === 'Rolling') return '';
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(dataFolder, name), 'utf8'));
}

function addSheet(workbook, name, columns, rows, headerColour = 'FFEEF2F7') {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColour } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (columns.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  return sheet;
}

// Every SAP field we use, what it means, and which dashboard field it becomes.
// The `check` flag marks the ones I could not verify from documentation. They are
// probably right, but verify before relying on them in production.
const MAPPING = [
  ['A_PurchaseOrder', 'PurchaseOrder', 'Order number', 'id', false],
  ['A_PurchaseOrder', 'CompanyCode', 'Company code', '(not shown)', false],
  ['A_PurchaseOrder', 'PurchaseOrderType', 'Document type, NB is a standard order', '(not shown)', false],
  ['A_PurchaseOrder', 'Supplier', 'Supplier number', 'supplierId', false],
  ['A_PurchaseOrder', 'PurchasingOrganization', 'Buying organisation', '(not shown)', false],
  ['A_PurchaseOrder', 'PurchasingGroup', 'Buyer group', '(not shown)', false],
  ['A_PurchaseOrder', 'DocumentCurrency', 'Currency', '(assumed INR)', false],
  ['A_PurchaseOrder', 'PurchaseOrderDate', 'Order date', '(not shown)', false],
  ['A_PurchaseOrder', 'CreatedByUser', 'Who raised it', '(not shown)', false],
  ['A_PurchaseOrder', 'CreationDate', 'When it was raised', 'used to work out hours waiting', false],
  ['A_PurchaseOrder', 'PaymentTerms', 'Payment terms key', '(not shown)', false],
  ['A_PurchaseOrder', 'ReleaseIsNotCompleted', 'True while approval is outstanding', 'status = pending', true],

  ['A_PurchaseOrderItem', 'PurchaseOrder', 'Order number', 'id', false],
  ['A_PurchaseOrderItem', 'PurchaseOrderItem', 'Line number', '(single line assumed)', false],
  ['A_PurchaseOrderItem', 'Material', 'Material number', 'materialCode', false],
  ['A_PurchaseOrderItem', 'PurchaseOrderItemText', 'Material description', 'material', false],
  ['A_PurchaseOrderItem', 'Plant', 'Plant code', 'plant', false],
  ['A_PurchaseOrderItem', 'OrderQuantity', 'Quantity ordered', 'quantity', false],
  ['A_PurchaseOrderItem', 'PurchaseOrderQuantityUnit', 'Unit of measure', 'unit', false],
  ['A_PurchaseOrderItem', 'NetPriceAmount', 'Price', 'rate', false],
  ['A_PurchaseOrderItem', 'NetPriceQuantity', 'Price is per this many units', 'used to work out rate', false],
  ['A_PurchaseOrderItem', 'DocumentCurrency', 'Currency', '(assumed INR)', false],
  ['A_PurchaseOrderItem', 'MaterialGroup', 'Material group', '(not shown)', false],
  ['A_PurchaseOrderItem', 'StorageLocation', 'Storage location', '(not shown)', false],
  ['A_PurchaseOrderItem', 'IsCompletelyDelivered', 'Delivery complete flag', '(not shown)', false],
  ['A_PurchaseOrderItem', 'NetAmount', 'Line value', 'value', true],

  ['A_PurchaseRequisitionHeader', 'PurchaseRequisition', 'Request number', 'id', false],
  ['A_PurchaseRequisitionHeader', 'PurchaseRequisitionType', 'Document type', '(not shown)', false],
  ['A_PurchaseRequisitionHeader', 'CreationDate', 'When it was raised', 'used to work out hours waiting', false],
  ['A_PurchaseRequisitionHeader', 'CreatedByUser', 'Who raised it', '(not shown)', false],

  ['A_PurchaseRequisitionItem', 'PurchaseRequisition', 'Request number', 'id', false],
  ['A_PurchaseRequisitionItem', 'PurchaseRequisitionItem', 'Line number', '(single line assumed)', false],
  ['A_PurchaseRequisitionItem', 'Material', 'Material number', 'materialCode', false],
  ['A_PurchaseRequisitionItem', 'PurchaseRequisitionItemText', 'Material description', 'material', false],
  ['A_PurchaseRequisitionItem', 'Plant', 'Plant code', 'plant', false],
  ['A_PurchaseRequisitionItem', 'RequestedQuantity', 'Quantity requested', 'quantity', false],
  ['A_PurchaseRequisitionItem', 'BaseUnit', 'Unit of measure', 'unit', false],
  ['A_PurchaseRequisitionItem', 'PurchaseRequisitionPrice', 'Estimated price', 'rate', false],
  ['A_PurchaseRequisitionItem', 'Supplier', 'Suggested supplier', 'supplierId', false],
  ['A_PurchaseRequisitionItem', 'DeliveryDate', 'Wanted by', 'deliveryDate', false],
  ['A_PurchaseRequisitionItem', 'PurchasingGroup', 'Buyer group', '(not shown)', false],
  ['A_PurchaseRequisitionItem', 'PurReqnReleaseStatus', 'Approval status', 'status', true],

  ['A_Supplier', 'Supplier', 'Supplier number', 'id', false],
  ['A_Supplier', 'SupplierName', 'Supplier name', 'name', false],
  ['A_Supplier', 'SupplierFullName', 'Full legal name', '(not shown)', false],
  ['A_Supplier', 'SupplierAccountGroup', 'Account group', '(not shown)', false],
  ['A_Supplier', 'PurchasingIsBlocked', 'Blocked for purchasing', '(not shown, but should be)', false],
  ['A_Supplier', 'PostingIsBlocked', 'Blocked for posting', '(not shown)', false],
  ['A_Supplier', 'DeletionIndicator', 'Marked for deletion', '(not shown)', false],
  ['A_Supplier', 'CreationDate', 'Created on', '(not shown)', false],

  ['A_Product', 'Product', 'Material number', 'code', false],
  ['A_Product', 'ProductType', 'Material type, ROH is raw material', '(not shown)', false],
  ['A_Product', 'BaseUnit', 'Base unit of measure', 'unit', false],
  ['A_Product', 'ProductGroup', 'Material group', '(not shown)', false],
  ['A_Product', 'IsMarkedForDeletion', 'Marked for deletion', '(not shown)', false],
  ['A_Product', 'CreationDate', 'Created on', '(not shown)', false],

  ['A_ProductPlant', 'Product', 'Material number', 'code', false],
  ['A_ProductPlant', 'Plant', 'Plant code', 'plant', false],
  ['A_ProductPlant', 'ReorderThresholdQuantity', 'Reorder point', 'reorderPoint', false],
  ['A_ProductPlant', 'SafetyStockQuantity', 'Safety stock', 'safetyStock', false],
  ['A_ProductPlant', 'PlannedDeliveryDurationInDays', 'Planned delivery time in days', 'leadTimeDays', false],
  ['A_ProductPlant', 'MRPType', 'Planning type', '(not shown)', false],
  ['A_ProductPlant', 'MRPController', 'Planner', '(not shown)', false],
  ['A_ProductPlant', 'PurchasingGroup', 'Buyer group', '(not shown)', false],
  ['A_ProductPlant', 'GoodsReceiptDuration', 'Goods receipt processing days', 'add to lead time', true],
  ['A_ProductPlant', 'IsMarkedForDeletion', 'Marked for deletion', '(not shown)', false],

  ['A_MaterialStock', 'Material', 'Material number', 'code', false],
  ['A_MaterialStock', 'Plant', 'Plant code', 'plant', false],
  ['A_MaterialStock', 'StorageLocation', 'Storage location', '(summed across locations)', false],
  ['A_MaterialStock', 'MatlWrhsStkQtyInMatlBaseUnit', 'Quantity in stock', 'onHand', false],
  ['A_MaterialStock', 'MaterialBaseUnit', 'Unit of measure', 'unit', false],
  ['A_MaterialStock', 'InventoryStockType', 'Stock type, 01 is unrestricted use', 'filter to unrestricted only', false],
  ['A_MaterialStock', 'InventorySpecialStockType', 'Special stock type', 'exclude consignment', false]
];

// What SAP genuinely cannot give us. Being explicit about this is the point: it is the
// difference between an honest demo and one that falls over in front of a customer.
const NOT_IN_SAP = [
  ['Who is holding an approval', 'Workflow work items, table SWWWIHEAD', 'Not exposed by any standard OData service. Needs a custom service or the workflow API.'],
  ['Why an approval is stuck', 'Derived from the work item and its history', 'No standard field says "waiting on the cost centre owner". Has to be worked out.'],
  ['Approver absence and stand-in', 'Substitution table HRUS_D2', 'No standard OData service.'],
  ['Hours waiting', 'Now minus work item creation time', 'Can be derived from CreationDate as an approximation, but that is when the document was raised, not when it reached this approver.'],
  ['Ten-order delivery history', 'Goods receipts vs confirmed delivery dates', 'Possible to build from A_MaterialDocumentItem plus the order schedule lines, but it is real work, not one call.'],
  ['Quality percentage per delivery', 'Inspection lots, table QALS', 'Needs the quality management module and a separate API.'],
  ['Average daily consumption', 'Historical goods issues', 'Derive from material documents over a chosen period. Not a stored field.'],
  ['Approving from the dashboard', 'Release of a purchase order', 'The sandbox is read-only. A real system needs the release API or a custom service, plus the approver\'s own authorisation.']
];

async function main() {
  const suppliersFile = await readJson('suppliers.json');
  const documentsFile = await readJson('purchase-documents.json');
  const stockFile = await readJson('stock.json');

  const orders = documentsFile.documents.filter((d) => d.type === 'order');
  const requests = documentsFile.documents.filter((d) => d.type === 'request');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Procurement Dashboard';
  workbook.created = new Date();

  // --- ReadMe -------------------------------------------------------------
  const readme = workbook.addWorksheet('ReadMe');
  readme.columns = [{ width: 4 }, { width: 118 }];
  const say = (text, bold = false) => {
    const row = readme.addRow(['', text]);
    if (bold) row.getCell(2).font = { bold: true };
    return row;
  };

  say('SAP source tables for the procurement dashboard', true);
  say('');
  say('Each sheet below is named after an SAP OData entity and holds the same demo data as the');
  say('dashboard, but with SAP field names as the column headers.');
  say('');
  say('What it is for', true);
  say('1. Give it to whoever runs your SAP system. They can produce a real extract in this shape');
  say('   without needing to know anything about the dashboard.');
  say('2. Use it to write SapProvider in milestone 4. The FieldMapping sheet lists every');
  say('   translation that layer has to perform.');
  say('');
  say('The services these come from', true);
  say('A_PurchaseOrder, A_PurchaseOrderItem        API_PURCHASEORDER_PROCESS_SRV');
  say('A_PurchaseRequisitionHeader / Item          API_PURCHASEREQ_PROCESS_SRV');
  say('A_Supplier                                  API_BUSINESS_PARTNER');
  say('A_Product, A_ProductPlant                   API_PRODUCT_SRV');
  say('A_MaterialStock                             API_MATERIAL_STOCK_SRV');
  say('');
  say('Check the field names yourself before relying on them', true);
  say('Field names change between releases. The definitive list for YOUR system is the service');
  say('metadata. Fetch it with:');
  say('   <base URL>/API_PRODUCT_SRV/$metadata          with your APIKey header');
  say('or read it at https://api.sap.com, open the API, then the API Reference tab.');
  say('');
  say('Four fields in the FieldMapping sheet are marked "verify". They are the ones I could not');
  say('confirm from documentation. They are probably correct, but check them first.');
  say('');
  say('The values are invented', true);
  say('Company code 1000, plants 1010 / 1020 / 1030 and the supplier numbers are made up to look');
  say('like SAP data. A real extract will have your own. The units MT, NOS and TRIP will also need');
  say('mapping to whatever unit keys your system actually uses.');
  say('');
  say('What SAP cannot give us at all', true);
  say('See the NotAvailableInSAP sheet. Those items have to stay simulated no matter what, and');
  say('they are the honest limits of what this dashboard can claim.');

  // --- Field mapping -------------------------------------------------------
  addSheet(
    workbook,
    'FieldMapping',
    [
      { key: 'entity', header: 'SAP entity', width: 30 },
      { key: 'field', header: 'SAP field', width: 34 },
      { key: 'meaning', header: 'What it means', width: 44 },
      { key: 'dashboard', header: 'Dashboard field', width: 34 },
      { key: 'verify', header: 'Verify first', width: 13 }
    ],
    MAPPING.map(([entity, field, meaning, dashboard, check]) => ({
      entity,
      field,
      meaning,
      dashboard,
      verify: check ? 'verify' : ''
    })),
    'FFE8F1FD'
  );

  // --- A_PurchaseOrder -----------------------------------------------------
  addSheet(
    workbook,
    'A_PurchaseOrder',
    [
      { key: 'PurchaseOrder', header: 'PurchaseOrder', width: 16 },
      { key: 'CompanyCode', header: 'CompanyCode', width: 13 },
      { key: 'PurchaseOrderType', header: 'PurchaseOrderType', width: 18 },
      { key: 'Supplier', header: 'Supplier', width: 14 },
      { key: 'PurchasingOrganization', header: 'PurchasingOrganization', width: 22 },
      { key: 'PurchasingGroup', header: 'PurchasingGroup', width: 16 },
      { key: 'DocumentCurrency', header: 'DocumentCurrency', width: 17 },
      { key: 'PurchaseOrderDate', header: 'PurchaseOrderDate', width: 18 },
      { key: 'CreationDate', header: 'CreationDate', width: 14 },
      { key: 'CreatedByUser', header: 'CreatedByUser', width: 16 },
      { key: 'PaymentTerms', header: 'PaymentTerms', width: 14 },
      { key: 'ReleaseIsNotCompleted', header: 'ReleaseIsNotCompleted', width: 22 }
    ],
    orders.map((d) => ({
      PurchaseOrder: d.id,
      CompanyCode: COMPANY_CODE,
      PurchaseOrderType: 'NB',
      Supplier: sapSupplier(d.supplierId),
      PurchasingOrganization: PURCHASING_ORG,
      PurchasingGroup: PURCHASING_GROUP,
      DocumentCurrency: CURRENCY,
      PurchaseOrderDate: '2026-09-04',
      CreationDate: '2026-09-04',
      CreatedByUser: 'KMENON',
      PaymentTerms: 'NT30',
      ReleaseIsNotCompleted: d.status === 'pending'
    })),
    'FFE7F5EC'
  );

  // --- A_PurchaseOrderItem -------------------------------------------------
  addSheet(
    workbook,
    'A_PurchaseOrderItem',
    [
      { key: 'PurchaseOrder', header: 'PurchaseOrder', width: 16 },
      { key: 'PurchaseOrderItem', header: 'PurchaseOrderItem', width: 18 },
      { key: 'Material', header: 'Material', width: 14 },
      { key: 'PurchaseOrderItemText', header: 'PurchaseOrderItemText', width: 32 },
      { key: 'Plant', header: 'Plant', width: 8 },
      { key: 'StorageLocation', header: 'StorageLocation', width: 16 },
      { key: 'MaterialGroup', header: 'MaterialGroup', width: 15 },
      { key: 'OrderQuantity', header: 'OrderQuantity', width: 14 },
      { key: 'PurchaseOrderQuantityUnit', header: 'PurchaseOrderQuantityUnit', width: 25 },
      { key: 'NetPriceAmount', header: 'NetPriceAmount', width: 15 },
      { key: 'NetPriceQuantity', header: 'NetPriceQuantity', width: 17 },
      { key: 'NetAmount', header: 'NetAmount', width: 14 },
      { key: 'DocumentCurrency', header: 'DocumentCurrency', width: 17 },
      { key: 'IsCompletelyDelivered', header: 'IsCompletelyDelivered', width: 22 }
    ],
    orders.map((d) => ({
      PurchaseOrder: d.id,
      PurchaseOrderItem: '00010',
      Material: d.materialCode,
      PurchaseOrderItemText: d.material,
      Plant: PLANT_CODE[d.plant] || '',
      StorageLocation: '0001',
      MaterialGroup: d.materialCode.split('-')[0],
      OrderQuantity: d.quantity,
      PurchaseOrderQuantityUnit: d.unit,
      NetPriceAmount: d.rate,
      NetPriceQuantity: 1,
      NetAmount: d.value,
      DocumentCurrency: CURRENCY,
      IsCompletelyDelivered: false
    })),
    'FFE7F5EC'
  );

  // --- A_PurchaseRequisitionHeader ----------------------------------------
  addSheet(
    workbook,
    'A_PurchaseRequisitionHeader',
    [
      { key: 'PurchaseRequisition', header: 'PurchaseRequisition', width: 20 },
      { key: 'PurchaseRequisitionType', header: 'PurchaseRequisitionType', width: 24 },
      { key: 'CreationDate', header: 'CreationDate', width: 14 },
      { key: 'CreatedByUser', header: 'CreatedByUser', width: 16 }
    ],
    requests.map((d) => ({
      PurchaseRequisition: d.id,
      PurchaseRequisitionType: 'NB',
      CreationDate: '2026-09-06',
      CreatedByUser: 'PNAIR'
    })),
    'FFFDF0E4'
  );

  // --- A_PurchaseRequisitionItem ------------------------------------------
  // Worth knowing: the header entity alone carries no material, quantity or price. The
  // dashboard needs all three, so the item entity has to be read as well.
  addSheet(
    workbook,
    'A_PurchaseRequisitionItem',
    [
      { key: 'PurchaseRequisition', header: 'PurchaseRequisition', width: 20 },
      { key: 'PurchaseRequisitionItem', header: 'PurchaseRequisitionItem', width: 24 },
      { key: 'Material', header: 'Material', width: 14 },
      { key: 'PurchaseRequisitionItemText', header: 'PurchaseRequisitionItemText', width: 32 },
      { key: 'Plant', header: 'Plant', width: 8 },
      { key: 'RequestedQuantity', header: 'RequestedQuantity', width: 18 },
      { key: 'BaseUnit', header: 'BaseUnit', width: 11 },
      { key: 'PurchaseRequisitionPrice', header: 'PurchaseRequisitionPrice', width: 24 },
      { key: 'Supplier', header: 'Supplier', width: 14 },
      { key: 'PurchasingGroup', header: 'PurchasingGroup', width: 16 },
      { key: 'DeliveryDate', header: 'DeliveryDate', width: 14 },
      { key: 'PurReqnReleaseStatus', header: 'PurReqnReleaseStatus', width: 21 }
    ],
    requests.map((d) => ({
      PurchaseRequisition: d.id,
      PurchaseRequisitionItem: '00010',
      Material: d.materialCode,
      PurchaseRequisitionItemText: d.material,
      Plant: PLANT_CODE[d.plant] || '',
      RequestedQuantity: d.quantity,
      BaseUnit: d.unit,
      PurchaseRequisitionPrice: d.rate,
      Supplier: sapSupplier(d.supplierId),
      PurchasingGroup: PURCHASING_GROUP,
      DeliveryDate: isoDate(d.deliveryDate),
      PurReqnReleaseStatus: d.status === 'pending' ? 'X' : ''
    })),
    'FFFDF0E4'
  );

  // --- A_Supplier ----------------------------------------------------------
  addSheet(
    workbook,
    'A_Supplier',
    [
      { key: 'Supplier', header: 'Supplier', width: 14 },
      { key: 'SupplierName', header: 'SupplierName', width: 26 },
      { key: 'SupplierFullName', header: 'SupplierFullName', width: 32 },
      { key: 'SupplierAccountGroup', header: 'SupplierAccountGroup', width: 21 },
      { key: 'PurchasingIsBlocked', header: 'PurchasingIsBlocked', width: 20 },
      { key: 'PostingIsBlocked', header: 'PostingIsBlocked', width: 17 },
      { key: 'DeletionIndicator', header: 'DeletionIndicator', width: 18 },
      { key: 'CreationDate', header: 'CreationDate', width: 14 }
    ],
    suppliersFile.suppliers.map((s) => ({
      Supplier: sapSupplier(s.id),
      SupplierName: s.name,
      SupplierFullName: `${s.name} Private Limited`,
      SupplierAccountGroup: 'ZVEN',
      PurchasingIsBlocked: false,
      PostingIsBlocked: false,
      DeletionIndicator: false,
      CreationDate: '2025-04-01'
    })),
    'FFEEEAFC'
  );

  // --- A_Product -----------------------------------------------------------
  addSheet(
    workbook,
    'A_Product',
    [
      { key: 'Product', header: 'Product', width: 14 },
      { key: 'ProductType', header: 'ProductType', width: 13 },
      { key: 'BaseUnit', header: 'BaseUnit', width: 11 },
      { key: 'ProductGroup', header: 'ProductGroup', width: 14 },
      { key: 'IsMarkedForDeletion', header: 'IsMarkedForDeletion', width: 20 },
      { key: 'CreationDate', header: 'CreationDate', width: 14 }
    ],
    stockFile.materials.map((m) => ({
      Product: m.code,
      // ROH is a raw material, ERSA a spare part. Real SAP values, chosen from our codes.
      ProductType: m.code.startsWith('RM') ? 'ROH' : m.code.startsWith('SP') ? 'ERSA' : 'VERP',
      BaseUnit: m.unit,
      ProductGroup: m.code.split('-')[0],
      IsMarkedForDeletion: false,
      CreationDate: '2025-04-01'
    })),
    'FFEEEAFC'
  );

  // --- A_ProductPlant ------------------------------------------------------
  addSheet(
    workbook,
    'A_ProductPlant',
    [
      { key: 'Product', header: 'Product', width: 14 },
      { key: 'Plant', header: 'Plant', width: 8 },
      { key: 'MRPType', header: 'MRPType', width: 10 },
      { key: 'MRPController', header: 'MRPController', width: 15 },
      { key: 'PurchasingGroup', header: 'PurchasingGroup', width: 16 },
      { key: 'ReorderThresholdQuantity', header: 'ReorderThresholdQuantity', width: 25 },
      { key: 'SafetyStockQuantity', header: 'SafetyStockQuantity', width: 20 },
      { key: 'PlannedDeliveryDurationInDays', header: 'PlannedDeliveryDurationInDays', width: 30 },
      { key: 'GoodsReceiptDuration', header: 'GoodsReceiptDuration', width: 21 },
      { key: 'IsMarkedForDeletion', header: 'IsMarkedForDeletion', width: 20 }
    ],
    stockFile.materials.map((m) => ({
      Product: m.code,
      Plant: PLANT_CODE[m.plant] || '',
      MRPType: 'VB',
      MRPController: '001',
      PurchasingGroup: PURCHASING_GROUP,
      ReorderThresholdQuantity: m.reorderPoint,
      SafetyStockQuantity: m.safetyStock,
      PlannedDeliveryDurationInDays: m.leadTimeDays,
      GoodsReceiptDuration: 1,
      IsMarkedForDeletion: false
    })),
    'FFEEEAFC'
  );

  // --- A_MaterialStock -----------------------------------------------------
  addSheet(
    workbook,
    'A_MaterialStock',
    [
      { key: 'Material', header: 'Material', width: 14 },
      { key: 'Plant', header: 'Plant', width: 8 },
      { key: 'StorageLocation', header: 'StorageLocation', width: 16 },
      { key: 'Batch', header: 'Batch', width: 10 },
      { key: 'InventoryStockType', header: 'InventoryStockType', width: 19 },
      { key: 'InventorySpecialStockType', header: 'InventorySpecialStockType', width: 25 },
      { key: 'MatlWrhsStkQtyInMatlBaseUnit', header: 'MatlWrhsStkQtyInMatlBaseUnit', width: 29 },
      { key: 'MaterialBaseUnit', header: 'MaterialBaseUnit', width: 17 }
    ],
    stockFile.materials.map((m) => ({
      Material: m.code,
      Plant: PLANT_CODE[m.plant] || '',
      StorageLocation: '0001',
      Batch: '',
      // 01 is unrestricted use. Blocked and quality inspection stock exist too, and the
      // dashboard must only count unrestricted, or it will overstate what is available.
      InventoryStockType: '01',
      InventorySpecialStockType: '',
      MatlWrhsStkQtyInMatlBaseUnit: m.onHand,
      MaterialBaseUnit: m.unit
    })),
    'FFEEEAFC'
  );

  // --- What SAP cannot provide --------------------------------------------
  addSheet(
    workbook,
    'NotAvailableInSAP',
    [
      { key: 'need', header: 'What the dashboard needs', width: 34 },
      { key: 'where', header: 'Where it would live in SAP', width: 44 },
      { key: 'why', header: 'Why we cannot simply read it', width: 74 }
    ],
    NOT_IN_SAP.map(([need, where, why]) => ({ need, where, why })),
    'FFFDEBEA'
  );

  await workbook.xlsx.writeFile(OUTPUT);

  console.log('');
  console.log(`Created ${OUTPUT}`);
  console.log('');
  console.log('Sheets:');
  for (const sheet of workbook.worksheets) {
    const rows = Math.max(0, sheet.rowCount - 1);
    console.log(`  ${sheet.name.padEnd(30)} ${rows} rows`);
  }
  console.log('');
  console.log('Read the ReadMe sheet first. Four field names are marked "verify" in FieldMapping.');
  console.log('');
}

main().catch((error) => {
  console.error('Could not build the SAP dumps:', error.message);
  process.exit(1);
});
