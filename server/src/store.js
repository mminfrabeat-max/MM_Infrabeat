// Where writes go.
//
// The provider interface covers reading. This covers the other half: recording a decision,
// clearing a problem, raising a request, sending a mail, and reading the audit trail back.
//
// Two stores implement those five, and this file picks one from DATA_SOURCE. The routes
// import from here and never learn which they got, exactly as they never learn which
// provider is reading.
//
// The two stores are not equivalent, and the difference is worth naming. The Excel store
// writes four things one after another and hopes; the database store writes them in a
// transaction, so a decision cannot be half-recorded.

import { config } from './config.js';
import * as excel from './excel-store.js';
import * as database from './db-store.js';

export function canWrite() {
  return config.dataSource === 'excel' || config.dataSource === 'db';
}

export function storeName() {
  return config.dataSource;
}

function refuse() {
  throw new Error(
    `Changes cannot be saved with DATA_SOURCE="${config.dataSource}". ` +
      `Use "excel" for the workbook or "db" for SQLite.`
  );
}

// --- Decisions ---------------------------------------------------------------

export async function saveDecision(input) {
  if (config.dataSource === 'db') {
    return database.saveDecision(input);
  }

  if (config.dataSource === 'excel') {
    // The workbook has no transactions, so this is a sequence: save the decision, then log
    // it. Saving comes first so a logging failure can never lose the decision itself.
    await excel.updateDocument(input.documentId, {
      status: input.status,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      decisionNote: input.note,
      // The step moves with the document, so the row keeps saying where it actually is.
      step: input.outcome?.step || input.document.step || ''
    });

    // Two mails go out on a decision that passes a document on, and the log has one pair of
    // email columns. Each message therefore gets its own line rather than the second being
    // dropped, which is also how it reads best: two things were sent, two rows.
    await excel
      .appendActionLog({
        at: input.decidedAt,
        action: excelActionLabel(input),
        documentId: input.documentId,
        documentType: input.document.kind,
        supplierName: input.document.supplierName,
        value: input.document.total,
        decidedBy: input.decidedBy,
        note: input.note,
        emailTo: input.mail?.to || '',
        emailStatus: input.mail?.status || ''
      })
      .catch((error) => console.error('[api] decision saved but not logged:', error.message));

    if (input.initiatorMail) {
      await excel
        .appendActionLog({
          at: input.decidedAt,
          action: 'informed the buyer',
          documentId: input.documentId,
          documentType: input.document.kind,
          supplierName: input.document.supplierName,
          value: '',
          decidedBy: input.decidedBy,
          note: input.document.createdBy ? `To ${input.document.createdBy.name}` : '',
          emailTo: input.initiatorMail.to || '',
          emailStatus: input.initiatorMail.status || ''
        })
        .catch(() => {});
    }
    return;
  }

  refuse();
}

// "pending" describes the document, not what the manager did. An approval that moved a
// document on says so, and names who has it.
function excelActionLabel(input) {
  if (input.status !== 'pending') return input.status;
  return input.outcome?.movedTo ? `approved, passed to ${input.outcome.movedTo.name}` : 'approved';
}

// --- Problems ----------------------------------------------------------------

export async function saveSituationFix(input) {
  if (config.dataSource === 'db') return database.saveSituationFix(input);

  if (config.dataSource === 'excel') {
    await excel.updateSituation(input.reference, { status: 'fixed' });
    await excel
      .appendActionLog({
        at: input.fixedAt,
        action: 'problem fixed',
        documentId: input.reference,
        documentType: '',
        supplierName: input.relatedTo || '',
        value: '',
        decidedBy: input.fixedBy,
        note: input.fix,
        emailTo: '',
        emailStatus: ''
      })
      .catch(() => {});
    return;
  }

  refuse();
}

// --- Stock requests ------------------------------------------------------------

export async function saveStockRequest(input) {
  if (config.dataSource === 'db') return database.saveStockRequest(input);

  if (config.dataSource === 'excel') {
    await excel.updateMaterial(input.materialCode, input.plant, {
      openOrderQuantity: input.newOpenOrderQuantity
    });
    await excel
      .appendActionLog({
        at: input.raisedAt,
        action: 'request raised',
        documentId: input.materialCode,
        documentType: '',
        supplierName: input.supplierName || '',
        value: '',
        decidedBy: input.raisedBy,
        note: `${input.quantity} ${input.unit} of ${input.materialName} at ${input.plant}`,
        emailTo: '',
        emailStatus: ''
      })
      .catch(() => {});
    return;
  }

  refuse();
}

// --- Mail ----------------------------------------------------------------------

// --- Where the goods are ------------------------------------------------------

// Records that a released order has moved on to the next shipment stage.
//
// The same shape as a decision: write the change, then log it. The stage is stored on
// the document rather than as its own table, because there is exactly one of them per
// order and it only ever moves forwards - a history table would be a second copy of the
// action log, which already holds every move with its time and who recorded it.
export async function saveShipmentStage(input) {
  if (config.dataSource === 'db') {
    return database.saveShipmentStage(input);
  }

  if (config.dataSource === 'excel') {
    await excel.updateDocument(input.documentId, {
      shipmentStage: input.stage,
      shipmentStageAt: input.at,
      shipmentNote: input.note || ''
    });

    await excel
      .appendActionLog({
        at: input.at,
        action: input.actionLabel,
        documentId: input.documentId,
        documentType: input.document.kind,
        supplierName: input.document.supplierName || '',
        value: input.document.total || input.document.basic || 0,
        decidedBy: input.recordedBy,
        note: input.note || '',
        emailTo: '',
        emailStatus: ''
      })
      .catch((error) => console.error('[api] stage saved but not logged:', error.message));

    return;
  }

  refuse();
}

// --- Raising a document -------------------------------------------------------

// Saves a document that did not exist a moment ago, with its approval chain.
//
// The two stores disagree about where a requisition's "open request" lives, and the
// difference is structural rather than a detail. SQLite derives open requests from the
// documents themselves - a released requisition IS the open request, which is what the
// 'unconverted' status means - so nothing extra is written. The workbook keeps a separate
// OpenRequests sheet, so a row has to be put there by hand or the requisition is invisible
// on the commitments screen.
export async function createDocument(input) {
  if (config.dataSource === 'db') {
    return database.createDocument(input);
  }

  if (config.dataSource === 'excel') {
    const { document, item, chain, raisedBy, openRequest } = input;

    // Flattened into the workbook's shape: the approver objects become columns, because a
    // spreadsheet cannot hold an object. excel-store reads them back into objects.
    const row = {
      ...document,
      hoursWaiting: 0,
      sourceDocument: document.sourceDocument || '',
      step: chain.step || '',
      createdByName: raisedBy?.name || '',
      createdByTitle: raisedBy?.title || '',
      createdByWhen: raisedBy?.when || '',
      nextName: chain.next?.name || '',
      nextTitle: chain.next?.title || '',
      nextLevel: chain.next?.level || '',
      status: 'pending',
      decidedBy: '',
      decidedAt: '',
      decisionNote: ''
    };

    await excel.appendDocument({ document: row, item, openRequest });
    return { id: document.id };
  }

  refuse();
}

// The numbers already in use, so a new document can be given the next one.
export async function usedDocumentNumbers() {
  if (config.dataSource === 'db') return database.allDocumentNumbers();
  if (config.dataSource === 'excel') return excel.allDocumentIds();
  return [];
}

export async function saveMail(input) {
  if (config.dataSource === 'db') return database.saveMail(input);

  if (config.dataSource === 'excel') {
    await excel
      .appendActionLog({
        at: input.sentAt,
        action: 'mail sent',
        documentId: '',
        documentType: '',
        supplierName: '',
        value: '',
        decidedBy: input.sentBy,
        note: input.subject,
        emailTo: input.to,
        emailStatus: input.mail?.status || ''
      })
      .catch(() => {});
    return;
  }

  // A mail with no writable store still sends; there is simply nowhere to log it.
}

// --- The audit trail -------------------------------------------------------------

export async function readActionLog() {
  if (config.dataSource === 'db') return database.readActionLog();
  if (config.dataSource === 'excel') return excel.readActionLog();
  return [];
}
