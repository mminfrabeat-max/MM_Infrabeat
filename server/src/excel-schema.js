// The single description of what the workbook looks like: which sheets exist, and which
// column holds what.
//
// Both the builder script and the reader import this file. That is the whole point: if
// only one of them knew the layout, adding a column would mean editing two files and
// remembering why. Here, a new column is one edit.
//
// The `key` on each column is the field name our code uses. The `header` is what a person
// reads in Excel. They differ on purpose: code wants `hoursWaiting`, a manager wants
// "Hours waiting".

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));

export const WORKBOOK_PATH = path.resolve(thisFolder, '../data/procurement.xlsx');

export const SHEETS = {
  documents: 'PurchaseDocuments',
  suppliers: 'Suppliers',
  supplierHistory: 'SupplierHistory',
  materials: 'Materials',
  situations: 'Situations',
  actionLog: 'ActionLog'
};

export const COLUMNS = {
  documents: [
    { key: 'id', header: 'Document number', width: 18 },
    { key: 'type', header: 'Type', width: 10 },
    { key: 'supplierId', header: 'Supplier code', width: 14 },
    { key: 'material', header: 'Material', width: 30 },
    { key: 'materialCode', header: 'Material code', width: 14 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'quantity', header: 'Quantity', width: 11 },
    { key: 'unit', header: 'Unit', width: 8 },
    { key: 'rate', header: 'Price per unit', width: 14 },
    { key: 'contractRate', header: 'Agreed price', width: 14 },
    { key: 'value', header: 'Total value', width: 14 },
    { key: 'deliveryDate', header: 'Delivery', width: 14 },
    { key: 'hoursWaiting', header: 'Hours waiting', width: 13 },
    { key: 'heldWith', header: 'Sitting with', width: 18 },
    { key: 'step', header: 'Approval step', width: 18 },
    { key: 'rule', header: 'Rule', width: 38 },
    { key: 'reason', header: 'Why it has not moved', width: 52 },
    { key: 'status', header: 'Status', width: 12 },
    // These three are empty until somebody approves or rejects the document.
    { key: 'decidedBy', header: 'Decided by', width: 24 },
    { key: 'decidedAt', header: 'Decided at', width: 22 },
    { key: 'decisionNote', header: 'Note', width: 40 }
  ],

  suppliers: [
    { key: 'id', header: 'Supplier code', width: 14 },
    { key: 'name', header: 'Supplier name', width: 24 },
    { key: 'category', header: 'Category', width: 16 },
    { key: 'contractRate', header: 'Agreed price', width: 14 },
    { key: 'unit', header: 'Unit', width: 8 }
  ],

  supplierHistory: [
    { key: 'supplierId', header: 'Supplier code', width: 14 },
    { key: 'order', header: 'Order number', width: 16 },
    { key: 'month', header: 'Month', width: 10 },
    { key: 'daysLate', header: 'Days late', width: 11 },
    { key: 'qualityPercent', header: 'Quality %', width: 11 },
    { key: 'rate', header: 'Price per unit', width: 14 },
    { key: 'value', header: 'Order value', width: 14 }
  ],

  materials: [
    { key: 'code', header: 'Material code', width: 14 },
    { key: 'name', header: 'Material', width: 28 },
    { key: 'plant', header: 'Plant', width: 10 },
    { key: 'onHand', header: 'In stock', width: 12 },
    { key: 'unit', header: 'Unit', width: 8 },
    { key: 'safetyStock', header: 'Safety level', width: 13 },
    { key: 'reorderPoint', header: 'Reorder at', width: 12 },
    { key: 'openOrderQuantity', header: 'On order', width: 11 },
    { key: 'dailyUsage', header: 'Used per day', width: 13 },
    { key: 'leadTimeDays', header: 'Lead time days', width: 15 },
    { key: 'supplierId', header: 'Supplier code', width: 14 },
    { key: 'supplierName', header: 'Supplier name', width: 22 }
  ],

  situations: [
    { key: 'id', header: 'Reference', width: 12 },
    { key: 'category', header: 'Category', width: 20 },
    { key: 'severity', header: 'Severity', width: 10 },
    { key: 'icon', header: 'Icon', width: 10 },
    { key: 'title', header: 'Problem', width: 40 },
    { key: 'detail', header: 'Detail', width: 70 },
    { key: 'relatedTo', header: 'About', width: 16 },
    { key: 'detectedAt', header: 'Found at', width: 11 },
    { key: 'cause', header: 'Cause', width: 60 },
    { key: 'proposedFix', header: 'Suggested fix', width: 60 },
    { key: 'canAutoFix', header: 'Can fix automatically', width: 20 },
    { key: 'status', header: 'Status', width: 12 }
  ],

  actionLog: [
    { key: 'at', header: 'When', width: 22 },
    { key: 'action', header: 'Action', width: 12 },
    { key: 'documentId', header: 'Document number', width: 18 },
    { key: 'documentType', header: 'Type', width: 10 },
    { key: 'supplierName', header: 'Supplier', width: 24 },
    { key: 'value', header: 'Value', width: 14 },
    { key: 'decidedBy', header: 'Decided by', width: 26 },
    { key: 'note', header: 'Note', width: 40 },
    { key: 'emailTo', header: 'Email sent to', width: 28 },
    { key: 'emailStatus', header: 'Email status', width: 32 }
  ]
};
