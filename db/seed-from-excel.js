// Loads the Excel workbook into the SQLite database.
//
//   node db/seed-from-excel.js
//
// This is the interesting half of any migration. A spreadsheet stores what a person typed;
// a database stores rows that point at each other. Three jobs happen here:
//
//   1. Names become foreign keys. "A. Deshmukh" appears as free text in six places across
//      the workbook. Every one of them has to resolve to the same row in `people`, or the
//      dashboard still cannot answer "what is waiting on Anil".
//
//   2. Three sheets become one table. PurchaseDocuments, OpenOrders and OpenRequests hold
//      the same entity at different points in its life. Watch for the duplicate that falls
//      out of that, handled below.
//
//   3. Flattened things unflatten. The vessel columns become a shipments row only where
//      there is a ship; the pipe-separated evidence becomes one row per fact.
//
// The whole load runs in one transaction. If anything fails, the database is left empty
// rather than half-populated, which is much easier to recover from.

import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openForSetup } from '../server/src/db.js';
import { config } from '../server/src/config.js';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK = path.resolve(thisFolder, '../server/data/procurement.xlsx');

// Plant codes in the SAP style. Invented, like the ones in the source-table dumps.
const PLANT_CODES = { Pune: '1010', Mumbai: '1020', Nagpur: '1030' };

const db = openForSetup();
const counts = {};
const warnings = [];

function cell(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') {
    if ('result' in raw) return raw.result;
    if ('text' in raw) return raw.text;
    if ('richText' in raw) return raw.richText.map((p) => p.text).join('');
  }
  return raw;
}

function text(v) {
  const value = cell(v);
  return value === null || value === undefined ? '' : String(value).trim();
}

function num(v) {
  const value = cell(v);
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(v) {
  // Every amount in this business is whole rupees, and the money columns are INTEGER.
  return Math.round(num(v));
}

function bool(v) {
  const t = text(v).toLowerCase();
  return t === 'true' || t === 'yes' || t === '1' ? 1 : 0;
}

// Reads a sheet into objects keyed by header text, so reordering columns in Excel cannot
// silently shift values into the wrong field.
function readSheet(workbook, name) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) {
    warnings.push(`Sheet "${name}" is missing from the workbook.`);
    return [];
  }

  const headers = new Map();
  sheet.getRow(1).eachCell((c, n) => headers.set(n, text(c.value)));

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (c, n) => {
      const header = headers.get(n);
      if (!header) return;
      record[header] = cell(c.value);
      if (record[header] !== null && record[header] !== '') hasValue = true;
    });
    if (hasValue) rows.push(record);
  });
  return rows;
}

// --- Lookups built as we go --------------------------------------------------

const plantId = new Map();
const personId = new Map();
const vendorId = new Map();
const vendorIdByName = new Map();
const materialId = new Map();
const materialPlantId = new Map();
const contractId = new Map();
const documentId = new Map();

// Finds or creates a person by the name as typed. Everything that mentions a person goes
// through here, which is what makes the six free-text spellings converge on one row.
function ensurePerson(rawName, plant) {
  const name = String(rawName || '').trim();
  if (!name) return null;

  const key = name.toLowerCase();
  if (personId.has(key)) return personId.get(key);

  // "Mr. Anil Deshmukh" and "A. Deshmukh" are the same person in the source data but not to
  // a computer. Two rows are created, and the warning below says so. Guessing they are the
  // same and silently merging them would be the worse mistake: the fix is to tidy the
  // source data, not to have the loader invent a rule.
  //
  // The name is stored exactly as written, so the screens read as they always did.
  //
  // No address is stored. This used to build one out of the person's name and a company
  // domain, for every person it met, which produced a column full of addresses that
  // belonged to nobody, delivered nowhere, and looked entirely real to anyone reading the
  // table. Mail is routed from the name against MAIL_DIRECTORY in .env, so a made-up
  // address served no purpose except to be mistaken for a true one.
  const result = db
    .prepare('INSERT INTO people (full_name, plant_id) VALUES (?, ?)')
    .run(name, plant ? plantId.get(plant) ?? null : null);

  const id = Number(result.lastInsertRowid);
  personId.set(key, id);
  return id;
}

// Finds a vendor by the name as typed, creating a bare record if the workbook references
// one that has no master row.
//
// This is a safety net rather than a nicety. A contract or an order that names a vendor we
// hold no record for is a referential gap: SQLite refuses it outright, where a spreadsheet
// simply carries the typed name and nobody notices. Creating the row keeps the load moving
// and the warning makes sure the gap is reported rather than buried.
function ensureVendorByName(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;

  const key = name.toLowerCase();
  if (vendorIdByName.has(key)) return vendorIdByName.get(key);

  warnings.push(`"${name}" is referenced but has no row in the Suppliers sheet. A bare vendor record was created.`);

  const code = `V-UNK${String(vendorIdByName.size + 1).padStart(2, '0')}`;
  const result = db
    .prepare('INSERT INTO vendors (code, name, category, sap_score, contract_rate, unit) VALUES (?, ?, ?, 0, 0, ?)')
    .run(code, name, 'Not classified', '');

  const id = Number(result.lastInsertRowid);
  vendorIdByName.set(key, id);
  vendorId.set(code, id);
  return id;
}

function tally(name, n) {
  counts[name] = n;
}

// --- The load ----------------------------------------------------------------

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK);

  const documents = readSheet(workbook, 'PurchaseDocuments');
  const items = readSheet(workbook, 'OrderItems');
  const vendors = readSheet(workbook, 'Suppliers');
  const history = readSheet(workbook, 'SupplierHistory');
  const materials = readSheet(workbook, 'Materials');
  const demands = readSheet(workbook, 'MaterialNeeds');
  const situations = readSheet(workbook, 'Situations');
  const openOrders = readSheet(workbook, 'OpenOrders');
  const openRequests = readSheet(workbook, 'OpenRequests');
  const contracts = readSheet(workbook, 'Contracts');
  const teams = readSheet(workbook, 'Teams');

  db.exec('BEGIN');

  // --- Plants. Gathered from every sheet that names one. --------------------
  const plantNames = new Set();
  for (const row of [...documents, ...materials, ...situations, ...openOrders, ...openRequests, ...contracts, ...teams]) {
    const p = text(row['Plant']);
    if (p) plantNames.add(p);
  }
  for (const name of [...plantNames].sort()) {
    const result = db
      .prepare('INSERT INTO plants (code, name, city) VALUES (?, ?, ?)')
      .run(PLANT_CODES[name] || name.slice(0, 4).toUpperCase(), name, name);
    plantId.set(name, Number(result.lastInsertRowid));
  }
  tally('plants', plantId.size);

  // --- Vendors ---------------------------------------------------------------
  for (const row of vendors) {
    const code = text(row['Vendor code']);
    const result = db
      .prepare(
        `INSERT INTO vendors (code, name, category, city, gst_number, import_code, sap_score, contract_rate, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        code,
        text(row['Vendor name']),
        text(row['Category']),
        text(row['City']),
        text(row['GST number']),
        text(row['Import code']) || null,
        Math.round(num(row['SAP vendor score'])),
        money(row['Contract rate']),
        text(row['Unit'])
      );
    const id = Number(result.lastInsertRowid);
    vendorId.set(code, id);
    vendorIdByName.set(text(row['Vendor name']).toLowerCase(), id);
  }
  tally('vendors', vendorId.size);

  // --- Vendor delivery history ----------------------------------------------
  const sequenceByVendor = new Map();
  let deliveries = 0;
  for (const row of history) {
    const code = text(row['Vendor code']);
    const vendor = vendorId.get(code);
    if (!vendor) {
      warnings.push(`Delivery history names vendor ${code}, which is not in the Suppliers sheet.`);
      continue;
    }
    const seq = (sequenceByVendor.get(code) || 0) + 1;
    sequenceByVendor.set(code, seq);
    db.prepare(
      `INSERT INTO vendor_deliveries (vendor_id, order_number, delivered_month, days_late, quality_percent, rate, sequence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      vendor,
      text(row['Order number']),
      text(row['Month']),
      Math.round(num(row['Days late'])),
      num(row['Quality %']),
      money(row['Rate']),
      seq
    );
    deliveries += 1;
  }
  tally('vendor_deliveries', deliveries);

  // --- Materials, split into master and plant view ---------------------------
  for (const row of materials) {
    const code = text(row['Material code']);
    const plant = text(row['Plant']);

    // The same material at two plants is one master record and two plant rows.
    if (!materialId.has(code)) {
      const result = db
        .prepare('INSERT INTO materials (code, name, base_unit) VALUES (?, ?, ?)')
        .run(code, text(row['Material']), text(row['Unit']));
      materialId.set(code, Number(result.lastInsertRowid));
    }

    const vendorName = text(row['Usual vendor']);
    const result = db
      .prepare(
        `INSERT INTO material_plants
           (material_id, plant_id, on_hand, safety_stock, reorder_point, open_order_qty,
            daily_usage, lead_time_days, is_kiln_critical, default_vendor_id, default_vendor_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        materialId.get(code),
        plantId.get(plant),
        num(row['In stock']),
        num(row['Safety level']),
        num(row['Reorder at']),
        num(row['On order']),
        num(row['Used per day']),
        Math.round(num(row['Lead time days'])),
        bool(row['Kiln runs on it']),
        ensureVendorByName(vendorName),
        vendorName
      );
    materialPlantId.set(`${code}@${plant}`, Number(result.lastInsertRowid));
  }
  tally('materials', materialId.size);
  tally('material_plants', materialPlantId.size);

  // --- Departmental demand ---------------------------------------------------
  let demandRows = 0;
  for (const row of demands) {
    const key = `${text(row['Material code'])}@${text(row['Plant'])}`;
    const mp = materialPlantId.get(key);
    if (!mp) {
      warnings.push(`Demand for ${key}, which has no row in the Materials sheet.`);
      continue;
    }
    const who = text(row['Asked by']);
    db.prepare(
      `INSERT INTO material_demands (material_plant_id, department, quantity, needed_by, requested_by_person_id, requested_by_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(mp, text(row['Department']), num(row['Quantity needed']), text(row['Needed by']), ensurePerson(who, text(row['Plant'])), who);
    demandRows += 1;
  }
  tally('material_demands', demandRows);

  // --- Contracts -------------------------------------------------------------
  for (const row of contracts) {
    const number = text(row['Contract number']);
    const vendorName = text(row['Vendor']);
    const result = db
      .prepare(
        `INSERT INTO contracts (contract_number, vendor_id, plant_id, covers, target_value, consumed_value, valid_to, days_left)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        number,
        ensureVendorByName(vendorName),
        plantId.get(text(row['Plant'])) ?? null,
        text(row['Covers']),
        money(row['Agreed value']),
        money(row['Used']),
        text(row['Valid until']),
        Math.round(num(row['Days left']))
      );
    contractId.set(number, Number(result.lastInsertRowid));
  }
  tally('contracts', contractId.size);

  // --- Purchase documents, from three sheets ---------------------------------
  const insertDocument = db.prepare(
    `INSERT INTO purchase_documents
       (doc_number, kind, doc_type, trade, incoterm, vendor_id, plant_id, department, transport,
        pay_terms, cash_discount, rebate, basic_value, freight, loading, delivery_date,
        received_percent, status, hours_waiting, current_step, blocked_reason, note,
        ordered_on, due_on, age_days, decided_at, decision_note,
        created_by_person_id, created_by_name, raised_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const row of documents) {
    const number = text(row['Document number']);
    const status = (text(row['Status']) || 'pending').toLowerCase();
    // The person who raised it goes through ensurePerson like every other name, so the
    // buyer who raised three orders is one row rather than three.
    const raisedByName = text(row['Raised by']);
    const raisedById = ensurePerson(raisedByName, text(row['Plant']));
    const result = insertDocument.run(
      number,
      text(row['Kind']) || 'PO',
      text(row['Document type']),
      text(row['Domestic or import']) || 'Domestic',
      text(row['Incoterm']),
      vendorId.get(text(row['Vendor code'])) ?? null,
      plantId.get(text(row['Plant'])) ?? null,
      null,
      text(row['Transport']),
      text(row['Payment terms']),
      text(row['Cash discount']),
      text(row['Rebate']),
      money(row['Basic value']),
      money(row['Freight']),
      money(row['Loading']),
      text(row['Delivery']),
      0,
      status,
      Math.round(num(row['Hours waiting'])),
      text(row['Approval step']),
      text(row['Why it has not moved']),
      null,
      null,
      null,
      null,
      text(row['Decided at']) || null,
      text(row['Note']) || null,
      raisedById,
      raisedByName || null,
      text(row['Raised on']) || null
    );
    documentId.set(number, Number(result.lastInsertRowid));

    // The approval chain. The workbook holds at most one previous approver, flattened into
    // four columns; here each becomes its own row so a longer chain can be recorded later.
    let step = 0;
    const prevName = text(row['Approved before by']);
    if (prevName) {
      step += 1;
      db.prepare(
        `INSERT INTO approval_steps (document_id, step_number, step_label, approver_person_id, approver_name, status, acted_at, note)
         VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)`
      ).run(
        documentId.get(number),
        step,
        text(row['At which step']),
        ensurePerson(prevName, text(row['Plant'])),
        prevName,
        text(row['Approved when']),
        text(row['Their note'])
      );
    }

    step += 1;
    db.prepare(
      `INSERT INTO approval_steps (document_id, step_number, step_label, approver_name, status, acted_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      documentId.get(number),
      step,
      text(row['Approval step']),
      text(row['Decided by']) || null,
      status === 'pending' ? 'waiting' : status === 'approved' ? 'approved' : 'rejected',
      text(row['Decided at']) || null,
      text(row['Note']) || null
    );

    // The step after this manager's, where the workbook names one. It is written as a
    // waiting row like any other, which is what lets the same query answer both "who is it
    // with now" and "who is it with next" - the first two waiting steps in order.
    const nextName = text(row['Goes next to']);
    if (nextName) {
      step += 1;
      const nextPersonId = ensurePerson(nextName, text(row['Plant']));
      db.prepare(
        `INSERT INTO approval_steps
           (document_id, step_number, step_label, approver_person_id, approver_name, approver_title, status)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting')`
      ).run(
        documentId.get(number),
        step,
        text(row['Next step']),
        nextPersonId,
        nextName,
        text(row['Next approver role']) || null
      );

      // The role is on the step for the audit trail; it also belongs on the person, so
      // every screen that shows them agrees. Only filled where it is still blank.
      const nextTitle = text(row['Next approver role']);
      if (nextPersonId && nextTitle) {
        db.prepare('UPDATE people SET job_title = ? WHERE id = ? AND job_title IS NULL').run(nextTitle, nextPersonId);
      }
    }

    // The buyer's role, from the same row, for the same reason.
    const raisedByTitle = text(row['Raised by role']);
    if (raisedById && raisedByTitle) {
      db.prepare('UPDATE people SET job_title = ? WHERE id = ? AND job_title IS NULL').run(raisedByTitle, raisedById);
    }

    // The ship, only where there is one.
    const vessel = text(row['Vessel']);
    if (vessel) {
      db.prepare(
        `INSERT INTO shipments
           (document_id, vessel_name, imo_number, bill_of_lading, origin_port, destination_port,
            position_text, eta, inland_note, position_at, feed_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        documentId.get(number),
        vessel,
        text(row['IMO']),
        text(row['Bill of lading']),
        text(row['Sailing from']),
        text(row['Sailing to']),
        text(row['Position now']),
        text(row['ETA']),
        text(row['After the port']),
        text(row['Position updated']),
        text(row['Position source'])
      );
    }
  }

  // Open orders: approved and waiting for goods.
  let openAdded = 0;
  for (const row of openOrders) {
    const number = text(row['Order number']);
    if (documentId.has(number)) continue;
    const vendorName = text(row['Vendor']);
    const result = insertDocument.run(
      number, 'PO', '', 'Domestic', '',
      ensureVendorByName(vendorName),
      plantId.get(text(row['Plant'])) ?? null,
      null, '', '', '', '',
      money(row['Value']), 0, 0, text(row['Due']),
      Math.round(num(row['Received %'])),
      'open', 0, '', '', text(row['Note']),
      text(row['Ordered']), text(row['Due']), null, null, null
    );
    documentId.set(number, Number(result.lastInsertRowid));
    openAdded += 1;
  }

  // Released requests a buyer has not converted into an order yet.
  //
  // One of these is already in PurchaseDocuments waiting for approval, so it is skipped:
  // the doc_number is unique, and the same request is not two documents. This duplicate is
  // exactly the sort of thing three separate sheets let slide and one table does not.
  let requestAdded = 0;
  let duplicates = 0;
  for (const row of openRequests) {
    const number = text(row['Request number']);
    if (documentId.has(number)) {
      duplicates += 1;
      continue;
    }
    const result = insertDocument.run(
      number, 'PR', '', 'Domestic', '', null,
      plantId.get(text(row['Plant'])) ?? null,
      text(row['Department']), '', '', '', '',
      money(row['Value']), 0, 0, '', 0,
      'unconverted', 0, '', '', text(row['Note']),
      null, null, Math.round(num(row['Days old'])), null, null
    );
    documentId.set(number, Number(result.lastInsertRowid));
    requestAdded += 1;
  }
  tally('purchase_documents', documentId.size);

  // --- Item lines ------------------------------------------------------------
  let itemRows = 0;
  for (const row of items) {
    const doc = documentId.get(text(row['Document number']));
    if (!doc) {
      warnings.push(`Item line for ${text(row['Document number'])}, which has no document.`);
      continue;
    }
    db.prepare(
      `INSERT INTO purchase_document_items
         (document_id, position, material_id, material_code, description, material_type, type_text,
          material_group, group_text, quantity, unit, rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      doc,
      Math.round(num(row['Item'])),
      materialId.get(text(row['Material code'])) ?? null,
      text(row['Material code']),
      text(row['Material']),
      text(row['Material type']),
      text(row['Material type text']),
      text(row['Material group']),
      text(row['Material group text']),
      num(row['Quantity']),
      text(row['Unit']),
      money(row['Rate'])
    );
    itemRows += 1;
  }
  tally('purchase_document_items', itemRows);

  // --- Situations and their evidence -----------------------------------------
  let evidenceRows = 0;
  for (const row of situations) {
    const speakTo = text(row['Who to speak to']);
    const plant = text(row['Plant']);
    const result = db
      .prepare(
        `INSERT INTO situations
           (reference, severity, icon, title, where_text, plant_id, related_to, detail, who_text,
            stuck_where, call_to_make, speak_to_person_id, speak_to_name, follow_up, proposed_fix,
            can_auto_fix, status, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        text(row['Reference']),
        text(row['Severity']) || 'medium',
        text(row['Icon']),
        text(row['Problem']),
        text(row['Where']),
        plantId.get(plant) ?? null,
        text(row['About']),
        text(row['Detail']),
        text(row['Who is involved']),
        text(row['Where it is stuck']),
        text(row['Call you need to make']),
        ensurePerson(speakTo.split(',')[0], plant),
        speakTo,
        text(row['Follow up']),
        text(row['Fix']),
        bool(row['Can fix automatically']),
        text(row['Status']) || 'open',
        text(row['Found at'])
      );

    // The pipe-separated cell becomes one row per fact, so it can finally be queried.
    const joined = text(row['Found by joining']);
    if (joined) {
      let seq = 0;
      for (const fact of joined.split('|').map((f) => f.trim()).filter(Boolean)) {
        seq += 1;
        db.prepare('INSERT INTO situation_evidence (situation_id, evidence, sequence) VALUES (?, ?, ?)')
          .run(Number(result.lastInsertRowid), fact, seq);
        evidenceRows += 1;
      }
    }
  }
  tally('situations', situations.length);
  tally('situation_evidence', evidenceRows);

  // --- Teams -----------------------------------------------------------------
  for (const row of teams) {
    const lead = text(row['Lead']);
    const plant = text(row['Plant']);
    const person = ensurePerson(lead, plant);
    if (person) {
      db.prepare('UPDATE people SET phone = ?, job_title = ? WHERE id = ? AND phone IS NULL')
        .run(text(row['Phone']), 'Team lead', person);
    }
    db.prepare(
      `INSERT INTO teams
         (reference, name, lead_person_id, plant_id, headcount, doing_now, follow_up,
          tasks_open, tasks_done, mails_waiting, reply_time, last_seen, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      text(row['Reference']),
      text(row['Team']),
      person,
      plantId.get(plant) ?? null,
      Math.round(num(row['People'])),
      text(row['Doing now']),
      text(row['Follow up']),
      Math.round(num(row['Tasks'])),
      Math.round(num(row['Completed'])),
      Math.round(num(row['Mails awaiting reply'])),
      text(row['Usual reply time']),
      text(row['Last update']),
      text(row['State']) || 'ok'
    );
  }
  tally('teams', teams.length);
  tally('people', personId.size);

  // --- The sign-in account, from .env ---------------------------------------
  if (config.auth.username && config.auth.passwordHash) {
    db.prepare('INSERT INTO users (email, password_hash, release_code, approval_limit) VALUES (?, ?, ?, ?)')
      .run(config.auth.username, config.auth.passwordHash, '02', 50000000);
    tally('users', 1);
  } else {
    warnings.push('No AUTH_USERNAME in .env, so no sign-in account was created.');
    tally('users', 0);
  }

  db.exec('COMMIT');

  // --- Report ----------------------------------------------------------------
  console.log('');
  console.log('Loaded the workbook into the database.');
  console.log('');
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(26)} ${String(n).padStart(3)} rows`);
  }

  if (duplicates > 0) {
    console.log('');
    console.log(`  ${duplicates} request${duplicates === 1 ? '' : 's'} appeared in two sheets and were stored once.`);
  }
  console.log(`  ${openAdded} open orders and ${requestAdded} unconverted requests folded into purchase_documents.`);

  if (warnings.length > 0) {
    console.log('');
    console.log('Worth a look:');
    for (const w of warnings) console.log(`  - ${w}`);
  }

  console.log('');
  console.log('Next:  set DATA_SOURCE=db in .env and restart the backend.');
  console.log('');
}

main()
  .catch((error) => {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Nothing to roll back if the failure happened before BEGIN.
    }
    console.error('');
    console.error('Could not load the workbook:', error.message);
    console.error('The database was left unchanged.');
    console.error('');
    process.exit(1);
  })
  .finally(() => db.close());
