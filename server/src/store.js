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
