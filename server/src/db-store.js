// Writing to the database.
//
// Same five operations as excel-store.js, same signatures, so the routes cannot tell which
// one they are calling. The difference is what happens underneath.
//
// A decision touches four things: the document, its approval step, the audit log and the
// notification. In the workbook those were four separate saves, and a crash between them
// could leave a document approved with no record of who did it. Here they are one
// transaction: all four land, or none do. That is the single biggest reason to move off a
// spreadsheet, and it is worth more than the query speed.

import { all, one, run, transaction, getDb } from './db.js';

// Takes an ADDRESS, never a display name: it matches on users.email. Passing a name here
// finds nobody, stores a NULL foreign key, and the row reads back with no author.
function userIdFor(email) {
  const row = one('SELECT id FROM users WHERE email = ?', [email]);
  return row ? row.id : null;
}

function documentRowFor(docNumber) {
  return one(
    `SELECT d.id, d.status, d.basic_value, d.freight, d.loading, d.kind, v.name AS vendor_name
       FROM purchase_documents d
       LEFT JOIN vendors v ON v.id = d.vendor_id
      WHERE d.doc_number = ?`,
    [docNumber]
  );
}

// Records a decision on one document: the document row, its final approval step, one audit
// line and one notification, together or not at all.
export function saveDecision({ documentId, status, decidedBy, decidedByAddress, decidedAt, note, document, mail, outcome, initiatorMail }) {
  return transaction((db) => {
    const row = documentRowFor(documentId);
    if (!row) throw new Error(`Document ${documentId} is not in the database.`);

    const userId = userIdFor(decidedByAddress || decidedBy);

    // current_step moves with the document. Without this the header would still name the
    // step just finished, and the screen would say an order was waiting at a step that had
    // already been signed.
    db.prepare(
      `UPDATE purchase_documents
          SET status = ?, decided_by_user_id = ?, decided_at = ?, decision_note = ?, current_step = ?
        WHERE id = ?`
    ).run(status, userId, decidedAt, note || null, outcome?.step || document.step || null, row.id);

    // Close the step that was waiting - the FIRST one, by step number.
    //
    // The obvious version of this closes every waiting step at once. That was harmless
    // while a document had one, and would be silently wrong now that it can have two: one
    // approval would sign off both this manager's step and the step belonging to the person
    // it was being passed to, and the document would arrive already approved by somebody
    // who had never seen it.
    const currentStep = one(
      `SELECT id FROM approval_steps
        WHERE document_id = ? AND status = 'waiting'
        ORDER BY step_number
        LIMIT 1`,
      [row.id]
    );

    if (currentStep) {
      db.prepare(
        `UPDATE approval_steps
            SET status = ?, acted_at = ?, note = ?, approver_name = ?
          WHERE id = ?`
      ).run(status === 'pending' ? 'approved' : status, decidedAt, note || null, decidedBy, currentStep.id);
    }

    // A document that has been sent back is not going anywhere, so the steps after it never
    // happen. Marking them skipped says that, where leaving them waiting would read as a
    // document still moving through a chain it has already fallen out of.
    if (status === 'rejected') {
      db.prepare(
        `UPDATE approval_steps SET status = 'skipped' WHERE document_id = ? AND status = 'waiting'`
      ).run(row.id);
    }

    const total = row.basic_value + row.freight + row.loading;

    const logged = db
      .prepare(
        `INSERT INTO action_log
           (occurred_at, action, user_id, acted_by, document_id, document_number, document_kind, vendor_name, value, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(decidedAt, actionLabel(status, outcome), userId, decidedBy, row.id, documentId, row.kind, row.vendor_name, total, note || null);

    // One row per message. Two mails leave on an approval that moves a document on, and an
    // outbox that recorded only one of them could not tell you which had failed.
    const logId = Number(logged.lastInsertRowid);

    saveNotification(db, logId, mail, `${row.kind} ${documentId} ${actionLabel(status, outcome)}`, decidedAt);

    if (initiatorMail) {
      saveNotification(db, logId, initiatorMail, `${row.kind} ${documentId} outcome, for information`, decidedAt);
    }
  });
}

// What the audit trail calls this. "pending" is the document's state, not a description of
// what anyone did, so an approval that passed a document on says exactly that.
function actionLabel(status, outcome) {
  if (status !== 'pending') return status;
  return outcome?.movedTo ? `approved, passed to ${outcome.movedTo.name}` : 'approved';
}

function saveNotification(db, actionLogId, mail, subject, at) {
  db.prepare(
    `INSERT INTO notifications (action_log_id, channel, to_address, subject, status, provider_message_id, attempts, sent_at, last_error)
     VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actionLogId,
    mail?.to || null,
    subject,
    mail?.sent ? 'sent' : 'failed',
    mail?.sent ? String(mail.status || '').replace(/^Sent /, '') : null,
    1,
    mail?.sent ? at : null,
    mail?.sent ? null : mail?.status || null
  );
}

// Marks a problem handled.
export function saveSituationFix({ reference, fixedAt, fixedBy, fixedByAddress, fix }) {
  return transaction((db) => {
    const row = one('SELECT id, related_to FROM situations WHERE reference = ?', [reference]);
    if (!row) throw new Error(`Problem ${reference} is not in the database.`);

    const userId = userIdFor(fixedByAddress || fixedBy);

    db.prepare(
      `UPDATE situations SET status = 'fixed', resolved_at = ?, resolved_by_user_id = ? WHERE id = ?`
    ).run(fixedAt, userId, row.id);

    db.prepare(
      `INSERT INTO action_log (occurred_at, action, user_id, acted_by, situation_id, vendor_name, note)
       VALUES (?, 'problem fixed', ?, ?, ?, ?, ?)`
    ).run(fixedAt, userId, fixedBy, row.id, row.related_to, fix);
  });
}

// Adds to the quantity on order for a material at a plant, which is what raising a request
// actually changes.
export function saveStockRequest({ materialCode, plant, quantity, unit, materialName, raisedAt, raisedBy, raisedByAddress }) {
  return transaction((db) => {
    const row = one(
      `SELECT mp.id, mp.open_order_qty, mp.default_vendor_name
         FROM material_plants mp
         JOIN materials m ON m.id = mp.material_id
         JOIN plants    p ON p.id = mp.plant_id
        WHERE m.code = ? AND p.name = ?`,
      [materialCode, plant]
    );
    if (!row) throw new Error(`${materialCode} at ${plant} is not in the database.`);

    db.prepare('UPDATE material_plants SET open_order_qty = ?, updated_at = ? WHERE id = ?')
      .run(row.open_order_qty + quantity, raisedAt, row.id);

    const userId = userIdFor(raisedByAddress || raisedBy);
    db.prepare(
      `INSERT INTO action_log (occurred_at, action, user_id, acted_by, material_plant_id, document_number, vendor_name, note)
       VALUES (?, 'request raised', ?, ?, ?, ?, ?, ?)`
    ).run(
      raisedAt,
      userId,
      raisedBy,
      row.id,
      materialCode,
      row.default_vendor_name,
      `${quantity} ${unit} of ${materialName} at ${plant}`
    );
  });
}

// A mail the manager typed. Logged whether it went or not, so there is a record either way.
export function saveMail({ to, subject, body, sentAt, sentBy, sentByAddress, mail }) {
  return transaction((db) => {
    const userId = userIdFor(sentByAddress || sentBy);

    const logged = db
      .prepare(
        `INSERT INTO action_log (occurred_at, action, user_id, acted_by, note)
         VALUES (?, 'mail sent', ?, ?, ?)`
      )
      .run(sentAt, userId, sentBy, subject);

    db.prepare(
      `INSERT INTO notifications (action_log_id, channel, to_address, subject, body, status, provider_message_id, attempts, sent_at, last_error)
       VALUES (?, 'email', ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      Number(logged.lastInsertRowid),
      to,
      subject,
      body,
      mail?.sent ? 'sent' : 'failed',
      mail?.sent ? String(mail.status || '').replace(/^Sent /, '') : null,
      mail?.sent ? sentAt : null,
      mail?.sent ? null : mail?.status || null
    );
  });
}

// The audit trail, newest first, with how the mail went alongside each entry.
export function readActionLog() {
  return all(
    `SELECT a.occurred_at, a.action, a.document_number, a.document_kind, a.vendor_name,
            a.value, a.acted_by, a.note, n.to_address, n.status AS mail_status, n.last_error
       FROM action_log a
       LEFT JOIN notifications n ON n.action_log_id = a.id
      ORDER BY a.id DESC
      LIMIT 200`
  ).map((r) => ({
    at: r.occurred_at,
    action: r.action,
    documentId: r.document_number || '',
    documentType: r.document_kind || '',
    supplierName: r.vendor_name || '',
    value: r.value ?? '',
    decidedBy: r.acted_by || '',
    note: r.note || '',
    emailTo: r.to_address || '',
    // The screens look for a status starting with "Sent", so keep that wording.
    emailStatus: r.mail_status === 'sent' ? 'Sent' : r.last_error || (r.mail_status ? 'Not sent' : '')
  }));
}

// --- Sessions -----------------------------------------------------------------
//
// These replace the in-memory map, so signing in survives a restart and two backends can
// share the same sessions. Only the hash of the token is stored: if the database leaks,
// the sessions in it cannot be used.

export function createSessionRow({ tokenHash, email, expiresAt, ip, userAgent }) {
  const userId = userIdFor(email);
  if (!userId) throw new Error(`No user record for ${email}.`);
  run(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
    [tokenHash, userId, expiresAt, ip || null, userAgent || null]
  );
}

export function readSessionRow(tokenHash) {
  return one(
    `SELECT s.token_hash, s.expires_at, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [tokenHash]
  );
}

export function deleteSessionRow(tokenHash) {
  run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
}

// Housekeeping. Expired rows would otherwise pile up forever.
export function purgeExpiredSessions() {
  run("DELETE FROM sessions WHERE expires_at < datetime('now')");
}

// --- Daily snapshot -------------------------------------------------------------
//
// One row per metric per plant per day. This is what would turn the tile sparklines from
// illustrative shapes into measured history, once a scheduled job calls it each morning.

export function recordDailyMetric({ capturedOn, plantName, metric, value }) {
  const plant = plantName ? one('SELECT id FROM plants WHERE name = ?', [plantName]) : null;
  run(
    `INSERT INTO daily_metrics (captured_on, plant_id, metric, value)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (captured_on, plant_id, metric) DO UPDATE SET value = excluded.value`,
    [capturedOn, plant ? plant.id : null, metric, value]
  );
}

export function readMetricHistory(metric, days = 7) {
  return all(
    `SELECT captured_on, SUM(value) AS value
       FROM daily_metrics
      WHERE metric = ?
      GROUP BY captured_on
      ORDER BY captured_on DESC
      LIMIT ?`,
    [metric, days]
  ).reverse();
}

// Kept so the module can be checked without a running server.
export function isReady() {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}
