// Makes sure there is a database to talk to, creating one if there is not.
//
//   node db/bootstrap.js
//
// This exists because of how hosting works. On your laptop you ran three commands once and
// the database has been sitting there ever since. A hosted server has no such history: it
// starts from a fresh copy of the repository every time it deploys, and on free plans it
// throws the disk away whenever the service sleeps.
//
// So the database has to be able to build itself from what IS in the repository. That is
// the JSON files in server/data, which are committed. The workbook and the database are
// not, because both are generated and both hold decisions.
//
// The chain is: JSON -> workbook -> database. Three steps that already existed as separate
// scripts; this just runs them in order when there is nothing there yet.
//
// It is deliberately safe to run every time. If a database already exists it does nothing,
// so it can sit in a start command without wiping data on every restart.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DB_PATH } from '../server/src/db.js';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(thisFolder, '..');
const WORKBOOK = path.join(root, 'server', 'data', 'procurement.xlsx');

function run(label, script, args = []) {
  process.stdout.write(`  ${label} ... `);
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    console.log('failed');
    console.error('');
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    process.exit(1);
  }
  console.log('done');
}

console.log('');

if (fs.existsSync(DB_PATH)) {
  console.log('Database already exists, leaving it alone.');
  console.log(`  ${DB_PATH}`);
  console.log('');
  console.log('To rebuild it from scratch:');
  console.log('  node db/migrate.js --force  &&  node db/seed-from-excel.js');
  console.log('');
  process.exit(0);
}

console.log('No database found. Building one from the committed JSON.');
console.log('');

// The seeder reads the workbook, and the workbook is generated rather than committed, so
// it has to be built first on a fresh checkout.
if (!fs.existsSync(WORKBOOK)) {
  run('workbook from JSON  ', 'server/scripts/build-workbook.js');
} else {
  console.log('  workbook            ... already there');
}

run('database schema     ', 'db/migrate.js');
run('load the workbook   ', 'db/seed-from-excel.js');

console.log('');
console.log('Ready.');
console.log('');
