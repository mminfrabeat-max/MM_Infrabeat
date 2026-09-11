// The single description of the workbook: which sheets exist, and which column holds what.
//
// Both the builder script and the reader import this file. That is the point: if only one
// of them knew the layout, adding a column would mean editing two files and remembering
// why. Here, a new column is one edit.
//
// `key` is the field name our code uses. `header` is what a person reads in Excel. They
// differ on purpose: code wants `hoursWaiting`, a manager wants "Hours waiting".
//
// Nested data becomes its own sheet, because a spreadsheet cell cannot hold a list. An
// order's item lines and a material's departmental demand each get a sheet keyed back to
// the parent. That is the same header-and-item split SAP itself uses.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));

export const WORKBOOK_PATH = path.resolve(thisFolder, '../data/procurement.xlsx');

// Used where a list has to live in one cell. Chosen because it appears in no real value.
export const LIST_SEPARATOR = ' | ';

export const SHEETS = {
  documents: 'PurchaseDocuments',
  orderItems: 'OrderItems',
  suppliers: 'Suppliers',
  supplierHistory: 'SupplierHistory',
  materials: 'Materials',
  materialNeeds: 'MaterialNeeds',
  situations: 'Situations',
  openOrders: 'OpenOrders',
  openRequests: 'OpenRequests',
  contracts: 'Contracts',
  teams: 'Teams',
  actionLog: 'ActionLog'
};

export const COLUMNS = {
  documents: [
    { key: 'id', header: 'Document number', width: 18 },
    { key: 'kind', header: 'Kind', width: 8 },
    { key: 'docType', header: 'Document type', width: 22 },
    { key: 'trade', header: 'Domestic or import', width: 18 },
    { key: 'incoterm', header: 'Incoterm', width: 28 },
    { key: 'supplierId', header: 'Vendor code', width: 13 },
    { key: 'material', header: 'Material', width: 30 },
    { key: 'materialCode', header: 'Material code', width: 14 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'quantity', header: 'Quantity', width: 11 },
    { key: 'unit', header: 'Unit', width: 8 },
    { key: 'rate', header: 'Rate', width: 13 },
    { key: 'basic', header: 'Basic value', width: 14 },
    { key: 'freight', header: 'Freight', width: 12 },
    { key: 'loading', header: 'Loading', width: 12 },
    { key: 'transport', header: 'Transport', width: 11 },
    { key: 'payTerms', header: 'Payment terms', width: 30 },
    { key: 'cashDiscount', header: 'Cash discount', width: 30 },
    { key: 'rebate', header: 'Rebate', width: 30 },
    { key: 'deliveryDate', header: 'Delivery', width: 16 },
    { key: 'hoursWaiting', header: 'Hours waiting', width: 13 },
    { key: 'step', header: 'Approval step', width: 20 },
    { key: 'reason', header: 'Why it has not moved', width: 40 },
    // Who raised the document. The mail confirming a decision goes back to this person,
    // so a document without one has nobody to tell.
    //
    // The name only. Where their mail goes is decided by MAIL_DIRECTORY in .env, keyed on
    // exactly this name, so an address here would be a second copy of the truth that
    // nothing reads and that would go stale the first time somebody's mailbox changed.
    { key: 'createdByName', header: 'Raised by', width: 20 },
    { key: 'createdByTitle', header: 'Raised by role', width: 24 },
    { key: 'createdByWhen', header: 'Raised on', width: 16 },
    // The requisition an order was created from. Empty on anything raised directly.
    // appendDocument adds this header to a workbook that predates it, so an older file
    // gains the column on first use instead of needing a rebuild.
    { key: 'sourceDocument', header: 'Created from', width: 18 },
    // The previous approver, flattened out of its own object.
    { key: 'prevName', header: 'Approved before by', width: 20 },
    { key: 'prevLevel', header: 'At which step', width: 20 },
    { key: 'prevWhen', header: 'Approved when', width: 16 },
    { key: 'prevNote', header: 'Their note', width: 38 },
    // Who it goes to after this manager approves. Empty means this approval is the last
    // one and the document is finished when it is given.
    //
    // Four flat columns can hold exactly one next approver, which is the limit of a
    // spreadsheet: a chain of three would need a fifth, then a ninth. The database keeps
    // the same information in approval_steps, one row per step, with no such ceiling.
    { key: 'nextName', header: 'Goes next to', width: 22 },
    { key: 'nextTitle', header: 'Next approver role', width: 24 },
    { key: 'nextLevel', header: 'Next step', width: 20 },
    // Ship tracking, only on import orders. Outside SAP entirely.
    { key: 'vesselName', header: 'Vessel', width: 18 },
    { key: 'vesselImo', header: 'IMO', width: 11 },
    { key: 'vesselBillOfLading', header: 'Bill of lading', width: 16 },
    { key: 'vesselFrom', header: 'Sailing from', width: 16 },
    { key: 'vesselTo', header: 'Sailing to', width: 13 },
    { key: 'vesselPosition', header: 'Position now', width: 26 },
    { key: 'vesselEta', header: 'ETA', width: 10 },
    { key: 'vesselAfterPort', header: 'After the port', width: 34 },
    { key: 'vesselUpdated', header: 'Position updated', width: 17 },
    { key: 'vesselSource', header: 'Position source', width: 26 },
    // Decision, empty until somebody approves or sends back.
    { key: 'status', header: 'Status', width: 12 },
    { key: 'decidedBy', header: 'Decided by', width: 24 },
    { key: 'decidedAt', header: 'Decided at', width: 22 },
    { key: 'decisionNote', header: 'Note', width: 40 },
    // Where the goods are, once the order has been released and the vendor has it.
    // Empty until then, and empty for ever on a requisition: nothing ships against a
    // request to buy.
    { key: 'shipmentStage', header: 'Shipment stage', width: 18 },
    { key: 'shipmentStageAt', header: 'Stage recorded at', width: 22 },
    { key: 'shipmentNote', header: 'Shipment note', width: 40 }
  ],

  orderItems: [
    { key: 'documentId', header: 'Document number', width: 18 },
    { key: 'pos', header: 'Item', width: 8 },
    { key: 'materialCode', header: 'Material code', width: 14 },
    { key: 'material', header: 'Material', width: 32 },
    { key: 'type', header: 'Material type', width: 14 },
    { key: 'typeText', header: 'Material type text', width: 18 },
    { key: 'group', header: 'Material group', width: 15 },
    { key: 'groupText', header: 'Material group text', width: 20 },
    { key: 'quantity', header: 'Quantity', width: 11 },
    { key: 'unit', header: 'Unit', width: 8 },
    { key: 'rate', header: 'Rate', width: 13 }
  ],

  suppliers: [
    { key: 'id', header: 'Vendor code', width: 13 },
    { key: 'name', header: 'Vendor name', width: 24 },
    { key: 'category', header: 'Category', width: 22 },
    { key: 'city', header: 'City', width: 16 },
    { key: 'gst', header: 'GST number', width: 30 },
    { key: 'iec', header: 'Import code', width: 18 },
    { key: 'sapScore', header: 'SAP vendor score', width: 17 },
    { key: 'contractRate', header: 'Contract rate', width: 14 },
    { key: 'unit', header: 'Unit', width: 8 }
  ],

  supplierHistory: [
    { key: 'supplierId', header: 'Vendor code', width: 13 },
    { key: 'order', header: 'Order number', width: 16 },
    { key: 'month', header: 'Month', width: 10 },
    { key: 'daysLate', header: 'Days late', width: 11 },
    { key: 'qualityPercent', header: 'Quality %', width: 11 },
    { key: 'rate', header: 'Rate', width: 13 }
  ],

  materials: [
    { key: 'code', header: 'Material code', width: 14 },
    { key: 'name', header: 'Material', width: 26 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'onHand', header: 'In stock', width: 12 },
    { key: 'unit', header: 'Unit', width: 8 },
    { key: 'safetyStock', header: 'Safety level', width: 13 },
    { key: 'reorderPoint', header: 'Reorder at', width: 12 },
    { key: 'openOrderQuantity', header: 'On order', width: 11 },
    { key: 'dailyUsage', header: 'Used per day', width: 13 },
    { key: 'leadTimeDays', header: 'Lead time days', width: 15 },
    { key: 'kiln', header: 'Kiln runs on it', width: 15 },
    { key: 'supplierName', header: 'Usual vendor', width: 22 }
  ],

  materialNeeds: [
    { key: 'materialCode', header: 'Material code', width: 14 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'dept', header: 'Department', width: 26 },
    { key: 'quantity', header: 'Quantity needed', width: 16 },
    { key: 'by', header: 'Needed by', width: 12 },
    { key: 'who', header: 'Asked by', width: 16 }
  ],

  situations: [
    { key: 'id', header: 'Reference', width: 11 },
    { key: 'severity', header: 'Severity', width: 10 },
    { key: 'icon', header: 'Icon', width: 9 },
    { key: 'title', header: 'Problem', width: 46 },
    { key: 'where', header: 'Where', width: 24 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'relatedTo', header: 'About', width: 26 },
    { key: 'detail', header: 'Detail', width: 70 },
    { key: 'who', header: 'Who is involved', width: 54 },
    { key: 'stuck', header: 'Where it is stuck', width: 46 },
    { key: 'call', header: 'Call you need to make', width: 46 },
    { key: 'speakTo', header: 'Who to speak to', width: 30 },
    { key: 'followUp', header: 'Follow up', width: 46 },
    { key: 'joined', header: 'Found by joining', width: 70 },
    { key: 'fix', header: 'Fix', width: 54 },
    { key: 'canAutoFix', header: 'Can fix automatically', width: 20 },
    { key: 'status', header: 'Status', width: 11 }
  ],

  openOrders: [
    { key: 'id', header: 'Order number', width: 16 },
    { key: 'supplierName', header: 'Vendor', width: 22 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'material', header: 'Material', width: 24 },
    { key: 'value', header: 'Value', width: 14 },
    { key: 'ordered', header: 'Ordered', width: 11 },
    { key: 'due', header: 'Due', width: 11 },
    { key: 'receivedPercent', header: 'Received %', width: 12 },
    { key: 'note', header: 'Note', width: 42 }
  ],

  openRequests: [
    { key: 'id', header: 'Request number', width: 16 },
    { key: 'dept', header: 'Department', width: 22 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'material', header: 'Material', width: 26 },
    { key: 'value', header: 'Value', width: 14 },
    { key: 'ageDays', header: 'Days old', width: 10 },
    { key: 'note', header: 'Note', width: 42 }
  ],

  contracts: [
    { key: 'id', header: 'Contract number', width: 16 },
    { key: 'supplierName', header: 'Vendor', width: 22 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'covers', header: 'Covers', width: 24 },
    { key: 'target', header: 'Agreed value', width: 15 },
    { key: 'used', header: 'Used', width: 14 },
    { key: 'validTo', header: 'Valid until', width: 14 },
    { key: 'daysLeft', header: 'Days left', width: 11 }
  ],

  teams: [
    { key: 'id', header: 'Reference', width: 10 },
    { key: 'name', header: 'Team', width: 26 },
    { key: 'lead', header: 'Lead', width: 22 },
    { key: 'people', header: 'People', width: 9 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'phone', header: 'Phone', width: 18 },
    { key: 'now', header: 'Doing now', width: 62 },
    { key: 'follow', header: 'Follow up', width: 62 },
    { key: 'tasks', header: 'Tasks', width: 9 },
    { key: 'done', header: 'Completed', width: 11 },
    { key: 'mailsWaiting', header: 'Mails awaiting reply', width: 20 },
    { key: 'replyTime', header: 'Usual reply time', width: 17 },
    { key: 'lastSeen', header: 'Last update', width: 16 },
    { key: 'state', header: 'State', width: 9 }
  ],

  actionLog: [
    { key: 'at', header: 'When', width: 22 },
    { key: 'action', header: 'Action', width: 12 },
    { key: 'documentId', header: 'Document number', width: 18 },
    { key: 'documentType', header: 'Kind', width: 8 },
    { key: 'supplierName', header: 'Vendor', width: 24 },
    { key: 'value', header: 'Value', width: 14 },
    { key: 'decidedBy', header: 'Decided by', width: 26 },
    { key: 'note', header: 'Note', width: 40 },
    { key: 'emailTo', header: 'Email sent to', width: 28 },
    { key: 'emailStatus', header: 'Email status', width: 34 }
  ]
};
