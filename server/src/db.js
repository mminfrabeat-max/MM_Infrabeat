// The SQLite connection.
//
// No npm package here. Node 22.5 and later ship SQLite in the runtime itself as
// node:sqlite, so there is nothing to install and nothing to compile. That matters on a
// laptop without build tools: the usual SQLite packages need a C compiler.
//
// DatabaseSync is synchronous, which looks wrong next to all the async code around it and
// is in fact correct. SQLite is a file on the same disk, not a network call. There is
// nothing to wait for, and an async wrapper around it would only add overhead. The
// provider methods stay async because the interface says so, not because the reads are.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));

export const DB_FOLDER = path.resolve(thisFolder, '../../db');
export const DB_PATH = path.join(DB_FOLDER, 'procurement.db');
export const SCHEMA_PATH = path.join(DB_FOLDER, 'schema.sql');

let connection = null;

export function getDb() {
  if (connection) return connection;

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `The database does not exist yet. Create it with:  node db/migrate.js`
    );
  }

  connection = new DatabaseSync(DB_PATH);
  applyPragmas(connection);
  upgradeInPlace(connection);
  return connection;
}

// Opens a connection for the setup scripts, creating the file if it is not there.
export function openForSetup() {
  fs.mkdirSync(DB_FOLDER, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  applyPragmas(db);
  return db;
}

// Adds columns a database created before them is missing.
//
// migrate.js builds the schema from scratch and has no notion of a version, so without
// this the only way to gain a column is --force, which deletes every decision in the file.
// ALTER TABLE ADD COLUMN is cheap, safe and idempotent: SQLite backfills NULL and existing
// rows are untouched. Checked against PRAGMA table_info rather than caught as an error, so
// a genuine failure is still a failure.
function upgradeInPlace(db) {
  const wanted = [
    { table: 'purchase_documents', column: 'source_doc_number', type: 'TEXT' },
    { table: 'purchase_documents', column: 'shipment_stage', type: 'TEXT' },
    { table: 'purchase_documents', column: 'shipment_stage_at', type: 'TEXT' },
    { table: 'purchase_documents', column: 'shipment_note', type: 'TEXT' },
    { table: 'purchase_documents', column: 'tracking_id', type: 'TEXT' },
    { table: 'purchase_documents', column: 'tracking_at', type: 'TEXT' }
  ];

  for (const { table, column, type } of wanted) {
    const exists = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`[db] added ${table}.${column}`);
    }
  }
}

function applyPragmas(db) {
  // SQLite has foreign keys OFF by default, for backwards compatibility with very old
  // databases. Forgetting this pragma is the classic reason constraints appear to do
  // nothing at all. It has to be set on every connection, not once on the file.
  db.exec('PRAGMA foreign_keys = ON');

  // Write-ahead logging lets one writer and several readers work at the same time instead
  // of blocking each other. For a dashboard that reads constantly and writes occasionally,
  // it is the right mode.
  db.exec('PRAGMA journal_mode = WAL');

  // If another process holds the write lock, wait up to five seconds rather than failing
  // instantly. Without this you get "database is locked" the moment two things overlap.
  db.exec('PRAGMA busy_timeout = 5000');
}

export function closeDb() {
  if (connection) {
    connection.close();
    connection = null;
  }
}

// --- Small query helpers -----------------------------------------------------
//
// These exist so the provider reads like SQL and nothing else, rather than repeating
// prepare-then-run at every call site.

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

export function one(sql, params = []) {
  return getDb().prepare(sql).get(...params) ?? null;
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

// Runs several writes as one unit: they all commit, or none of them do.
//
// This is the thing a spreadsheet could never give us. A decision touches the document,
// its approval step, the log and the notification. Half of that landing would leave a
// document approved with no record of who did it.
export function transaction(work) {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = work(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// SQLite has no boolean type. It stores 0 and 1, and these two turn that back into
// something JavaScript is comfortable with, in one place rather than at every read.
export function toBool(value) {
  return value === 1 || value === true;
}

export function fromBool(value) {
  return value ? 1 : 0;
}
