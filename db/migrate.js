// Creates db/procurement.db from db/schema.sql.
//
//   node db/migrate.js           create it, refusing if it already exists
//   node db/migrate.js --force   delete and recreate, losing everything in it
//
// The refusal matters once the database holds real decisions. This is the same guard the
// workbook builder has, for the same reason: the day you need it, you really need it.

import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, DB_FOLDER, SCHEMA_PATH } from '../server/src/db.js';

const force = process.argv.includes('--force');

if (fs.existsSync(DB_PATH) && !force) {
  console.error('');
  console.error(`The database already exists: ${DB_PATH}`);
  console.error('Refusing to overwrite it, because it may hold decisions you have made.');
  console.error('To start again from an empty schema, run:');
  console.error('  node db/migrate.js --force');
  console.error('');
  process.exit(1);
}

if (force) {
  // WAL mode leaves two sidecar files next to the database. Deleting only the main file
  // would leave those behind and SQLite would try to replay them into the new one.
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

fs.mkdirSync(DB_FOLDER, { recursive: true });

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
const db = new DatabaseSync(DB_PATH);

try {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(schema);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
    .all();

  console.log('');
  console.log(`Created ${DB_PATH}`);
  console.log('');
  console.log(`${tables.length} tables, ${indexes.length} indexes:`);
  for (const t of tables) {
    const columns = db.prepare(`PRAGMA table_info(${t.name})`).all().length;
    console.log(`  ${t.name.padEnd(26)} ${String(columns).padStart(2)} columns`);
  }
  console.log('');
  console.log('Next:  node db/seed-from-excel.js');
  console.log('');
} catch (error) {
  console.error('Could not create the database:', error.message);
  process.exit(1);
} finally {
  db.close();
}
