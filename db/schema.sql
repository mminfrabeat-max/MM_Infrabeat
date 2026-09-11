-- InfraBeat procurement dashboard: the database schema.
--
-- Twenty tables, in the four groups from the design note: master data, transactional,
-- operational, and infrastructure.
--
-- Three SQLite decisions worth knowing about, because they are not obvious:
--
-- 1. No STRICT tables, on purpose. STRICT would stop SQLite quietly storing the text
--    "hello" in an INTEGER column, and it is the better tool. It also needs SQLite 3.37,
--    from late 2021, and the VS Code SQLite extension bundles 3.26 from 2018 - so a schema
--    using STRICT cannot be opened in the editor at all. Being able to browse the database
--    while learning it is worth more than the strictest available check.
--
--    Most of that protection is bought back with CHECK (typeof(x) IN (...)) on the columns
--    where a wrong type would silently corrupt a calculation: stock levels, money and
--    rates. Those work on every SQLite ever shipped. Columns that are only ever displayed
--    are left unchecked, because a wrong type there is visible rather than dangerous.
--
-- 2. Money is INTEGER, in whole rupees. Every amount in this business is whole rupees, and
--    an integer cannot drift the way a floating point number can. Quantities and
--    percentages are REAL because 2.4 MT a day and 99.2 percent are genuinely fractional.
--
-- 3. Dates and times are TEXT in ISO 8601 (2026-09-22, or 2026-09-07T14:31:00Z). SQLite has
--    no date type. ISO sorts correctly as text, which is the whole reason to use it.
--
-- Foreign keys need turning on per connection with PRAGMA foreign_keys = ON. SQLite has
-- them off by default for backwards compatibility, and a missing pragma is the classic
-- reason constraints appear to do nothing.

PRAGMA foreign_keys = ON;

-- ===========================================================================
-- MASTER DATA
-- Changes rarely. Everything else points at it.
-- ===========================================================================

CREATE TABLE plants (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  city          TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note there is no email column. Where a person's mail goes is decided from their name
-- against MAIL_DIRECTORY in .env, which is the only place that knows. A column here would
-- have to be filled with something for everyone, and the something would be invented.
CREATE TABLE people (
  id                  INTEGER PRIMARY KEY,
  full_name           TEXT NOT NULL,
  phone               TEXT,
  job_title           TEXT,
  plant_id            INTEGER REFERENCES plants(id),
  -- Set when somebody is away. This plus stand_in_person_id is what problem S1 is about:
  -- an approver on leave with nobody named to cover them.
  on_leave_until      TEXT,
  stand_in_person_id  INTEGER REFERENCES people(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  person_id       INTEGER REFERENCES people(id),
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- scrypt$salt$key, the same format server/scripts/hash-password.js produces.
  password_hash   TEXT NOT NULL,
  release_code    TEXT,
  approval_limit  INTEGER,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vendors (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  category       TEXT,
  city           TEXT,
  gst_number     TEXT,
  import_code    TEXT,
  -- SAP's own vendor evaluation figure. Our score starts here and takes points off.
  sap_score      INTEGER NOT NULL DEFAULT 0,
  contract_rate  INTEGER NOT NULL DEFAULT 0,
  unit           TEXT,
  is_blocked     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  -- The score and the rate both feed arithmetic, so a text value here would break it
  -- quietly rather than loudly.
  CHECK (typeof(sap_score) = 'integer' AND typeof(contract_rate) IN ('integer', 'real'))
);

CREATE TABLE materials (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  base_unit       TEXT,
  material_type   TEXT,
  material_group  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The same material exists at several plants with different stock, lead time and
-- criticality. Keying on material alone would merge them, which is why SAP splits the
-- material master from its plant view and why we do too.
CREATE TABLE material_plants (
  id                 INTEGER PRIMARY KEY,
  material_id        INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  plant_id           INTEGER NOT NULL REFERENCES plants(id),
  on_hand            REAL NOT NULL DEFAULT 0,
  safety_stock       REAL NOT NULL DEFAULT 0,
  reorder_point      REAL NOT NULL DEFAULT 0,
  open_order_qty     REAL NOT NULL DEFAULT 0,
  daily_usage        REAL NOT NULL DEFAULT 0,
  lead_time_days     INTEGER NOT NULL DEFAULT 0,
  is_kiln_critical   INTEGER NOT NULL DEFAULT 0,
  default_vendor_id  INTEGER REFERENCES vendors(id),
  -- Kept for the case where the usual source is not a vendor we hold a record for.
  default_vendor_name TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (material_id, plant_id),
  -- Every one of these feeds the stock calculation. A number typed with a comma in a
  -- database browser would arrive as text and make days of cover silently wrong, which is
  -- exactly the sort of error nobody notices until a kiln stops.
  CHECK (
    typeof(on_hand)        IN ('integer', 'real') AND
    typeof(safety_stock)   IN ('integer', 'real') AND
    typeof(reorder_point)  IN ('integer', 'real') AND
    typeof(open_order_qty) IN ('integer', 'real') AND
    typeof(daily_usage)    IN ('integer', 'real') AND
    typeof(lead_time_days) =  'integer'
  )
);

CREATE TABLE teams (
  id              INTEGER PRIMARY KEY,
  reference       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  lead_person_id  INTEGER REFERENCES people(id),
  plant_id        INTEGER REFERENCES plants(id),
  headcount       INTEGER NOT NULL DEFAULT 0,
  doing_now       TEXT,
  follow_up       TEXT,
  tasks_open      INTEGER NOT NULL DEFAULT 0,
  tasks_done      INTEGER NOT NULL DEFAULT 0,
  mails_waiting   INTEGER NOT NULL DEFAULT 0,
  reply_time      TEXT,
  last_seen       TEXT,
  state           TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'nudge'))
);

-- ===========================================================================
-- TRANSACTIONAL
-- The documents themselves and everything hanging off them.
-- ===========================================================================

CREATE TABLE contracts (
  id               INTEGER PRIMARY KEY,
  contract_number  TEXT NOT NULL UNIQUE,
  vendor_id        INTEGER NOT NULL REFERENCES vendors(id),
  plant_id         INTEGER REFERENCES plants(id),
  covers           TEXT,
  target_value     INTEGER NOT NULL DEFAULT 0,
  -- Carried from the workbook for now. Once every release order names its contract, this
  -- becomes a SUM over purchase_documents and the column can go.
  consumed_value   INTEGER NOT NULL DEFAULT 0,
  valid_from       TEXT,
  valid_to         TEXT,
  days_left        INTEGER,
  -- Percent used is worked out from these two, and drives the never-used and nearly-used
  -- flags on the contracts screen.
  CHECK (typeof(target_value) IN ('integer', 'real') AND typeof(consumed_value) IN ('integer', 'real'))
);

-- One table for orders, requisitions, open orders and unconverted requests. They are the
-- same entity at different points in its life, and three tables would mean writing every
-- query three times.
CREATE TABLE purchase_documents (
  id                 INTEGER PRIMARY KEY,
  doc_number         TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL CHECK (kind IN ('PO', 'PR')),
  doc_type           TEXT,
  trade              TEXT CHECK (trade IN ('Domestic', 'Import')),
  incoterm           TEXT,
  vendor_id          INTEGER REFERENCES vendors(id),
  plant_id           INTEGER REFERENCES plants(id),
  contract_id        INTEGER REFERENCES contracts(id),
  department         TEXT,
  transport          TEXT,
  pay_terms          TEXT,
  cash_discount      TEXT,
  rebate             TEXT,
  basic_value        INTEGER NOT NULL DEFAULT 0,
  freight            INTEGER NOT NULL DEFAULT 0,
  loading            INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'INR',
  delivery_date      TEXT,
  received_percent   INTEGER NOT NULL DEFAULT 0,
  -- 'pending' is waiting on this manager. 'open' is approved and awaiting goods.
  -- 'unconverted' is a released request a buyer has not turned into an order yet.
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'open', 'unconverted')),
  hours_waiting      INTEGER NOT NULL DEFAULT 0,
  current_step       TEXT,
  blocked_reason     TEXT,
  note               TEXT,
  ordered_on         TEXT,
  due_on             TEXT,
  age_days           INTEGER,
  -- Who raised the document. Every decision on it is mailed back to this person, so a
  -- document with nobody here is one whose outcome nobody is told about.
  --
  -- The name is kept alongside the reference for the same reason default_vendor_name is:
  -- the workbook can name somebody we hold no people row for, and losing the name would be
  -- worse than storing it twice.
  created_by_person_id INTEGER REFERENCES people(id),
  created_by_name    TEXT,
  -- The requisition this order was created from, by document number rather than by row id,
  -- so the link survives a reseed and reads plainly in the file. Empty on anything raised
  -- directly. This is what stops one requisition being turned into two orders.
  source_doc_number  TEXT,
  -- Where the goods are once the order has been released. Empty until then, and always
  -- empty on a requisition: nothing ships against a request to buy.
  shipment_stage     TEXT,
  shipment_stage_at  TEXT,
  shipment_note      TEXT,
  raised_on          TEXT,
  decided_by_user_id INTEGER REFERENCES users(id),
  decided_at         TEXT,
  decision_note      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  -- Total payable is basic plus freight plus loading. If any of the three arrived as text,
  -- the sum would come out wrong on screen with nothing to show why.
  CHECK (
    typeof(basic_value) IN ('integer', 'real') AND
    typeof(freight)     IN ('integer', 'real') AND
    typeof(loading)     IN ('integer', 'real')
  )
);

CREATE TABLE purchase_document_items (
  id              INTEGER PRIMARY KEY,
  document_id     INTEGER NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  material_id     INTEGER REFERENCES materials(id),
  material_code   TEXT,
  description     TEXT,
  material_type   TEXT,
  type_text       TEXT,
  material_group  TEXT,
  group_text      TEXT,
  quantity        REAL NOT NULL DEFAULT 0,
  unit            TEXT,
  rate            INTEGER NOT NULL DEFAULT 0,
  UNIQUE (document_id, position),
  -- Line value is quantity times rate, shown on every order detail.
  CHECK (typeof(quantity) IN ('integer', 'real') AND typeof(rate) IN ('integer', 'real'))
);

-- The whole approval chain, one row per step. The workbook could hold exactly one previous
-- approver in four flattened columns; a three-step chain could not be recorded at all.
CREATE TABLE approval_steps (
  id                  INTEGER PRIMARY KEY,
  document_id         INTEGER NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
  step_number         INTEGER NOT NULL,
  step_label          TEXT,
  approver_person_id  INTEGER REFERENCES people(id),
  approver_name       TEXT,
  -- The role at the time, carried on the step rather than read from people every time,
  -- because a step has to keep saying what it was even if that person later changes job.
  -- An audit trail that rewrites itself is not one.
  --
  -- There is no address here on purpose. Where a step's mail goes is decided from the
  -- approver's name against MAIL_DIRECTORY in .env, which is the one place that knows.
  approver_title      TEXT,
  status              TEXT NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting', 'approved', 'rejected', 'skipped')),
  acted_at            TEXT,
  note                TEXT,
  UNIQUE (document_id, step_number)
);

-- Only import orders have one, which is why this is a table rather than ten columns that
-- sit empty on every domestic order. It also updates on its own clock, from a feed that is
-- nothing to do with SAP.
CREATE TABLE shipments (
  id               INTEGER PRIMARY KEY,
  document_id      INTEGER NOT NULL UNIQUE REFERENCES purchase_documents(id) ON DELETE CASCADE,
  vessel_name      TEXT,
  imo_number       TEXT,
  bill_of_lading   TEXT,
  origin_port      TEXT,
  destination_port TEXT,
  position_text    TEXT,
  latitude         REAL,
  longitude        REAL,
  eta              TEXT,
  inland_note      TEXT,
  position_at      TEXT,
  feed_source      TEXT
);

-- What departments have actually asked for, by when. This is what makes stock risk real
-- rather than a comparison against a reorder point somebody set two years ago.
CREATE TABLE material_demands (
  id                     INTEGER PRIMARY KEY,
  material_plant_id      INTEGER NOT NULL REFERENCES material_plants(id) ON DELETE CASCADE,
  department             TEXT NOT NULL,
  quantity               REAL NOT NULL DEFAULT 0,
  needed_by              TEXT,
  requested_by_person_id INTEGER REFERENCES people(id),
  requested_by_name      TEXT,
  is_fulfilled           INTEGER NOT NULL DEFAULT 0
);

-- The last ten orders per vendor. Feeds every trend chart and the whole score.
CREATE TABLE vendor_deliveries (
  id               INTEGER PRIMARY KEY,
  vendor_id        INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  order_number     TEXT NOT NULL,
  delivered_month  TEXT,
  days_late        INTEGER NOT NULL DEFAULT 0,
  quality_percent  REAL NOT NULL DEFAULT 0,
  rate             INTEGER NOT NULL DEFAULT 0,
  sequence         INTEGER NOT NULL,
  -- These three are the entire vendor score. Text in any of them would produce a score
  -- that looks plausible and is wrong.
  CHECK (
    typeof(days_late)       =  'integer' AND
    typeof(quality_percent) IN ('integer', 'real') AND
    typeof(rate)            IN ('integer', 'real')
  )
);

-- ===========================================================================
-- OPERATIONAL
-- What the system noticed, and what people did about it.
-- ===========================================================================

CREATE TABLE situations (
  id                  INTEGER PRIMARY KEY,
  reference           TEXT NOT NULL UNIQUE,
  severity            TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  icon                TEXT,
  category            TEXT,
  title               TEXT NOT NULL,
  where_text          TEXT,
  plant_id            INTEGER REFERENCES plants(id),
  related_to          TEXT,
  detail              TEXT,
  who_text            TEXT,
  stuck_where         TEXT,
  call_to_make        TEXT,
  speak_to_person_id  INTEGER REFERENCES people(id),
  speak_to_name       TEXT,
  follow_up           TEXT,
  proposed_fix        TEXT,
  can_auto_fix        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'dismissed')),
  detected_at         TEXT,
  resolved_at         TEXT,
  resolved_by_user_id INTEGER REFERENCES users(id)
);

-- The separate facts that had to be put side by side to spot the problem. One pipe
-- separated cell in the workbook, which cannot be queried at all.
CREATE TABLE situation_evidence (
  id            INTEGER PRIMARY KEY,
  situation_id  INTEGER NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  evidence      TEXT NOT NULL,
  source_system TEXT,
  sequence      INTEGER NOT NULL DEFAULT 0
);

-- Append only. Nothing updates or deletes a row here, which is what makes it an audit
-- trail rather than a status field.
CREATE TABLE action_log (
  id                INTEGER PRIMARY KEY,
  occurred_at       TEXT NOT NULL DEFAULT (datetime('now')),
  action            TEXT NOT NULL,
  user_id           INTEGER REFERENCES users(id),
  acted_by          TEXT,
  document_id       INTEGER REFERENCES purchase_documents(id),
  document_number   TEXT,
  document_kind     TEXT,
  situation_id      INTEGER REFERENCES situations(id),
  material_plant_id INTEGER REFERENCES material_plants(id),
  vendor_name       TEXT,
  value             INTEGER,
  note              TEXT
);

-- The mail outbox. Two columns on the log meant a failed send could never be retried,
-- because there was nowhere to record how many attempts had been made.
CREATE TABLE notifications (
  id                  INTEGER PRIMARY KEY,
  action_log_id       INTEGER REFERENCES action_log(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL DEFAULT 'email',
  to_address          TEXT,
  subject             TEXT,
  body                TEXT,
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  provider_message_id TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  sent_at             TEXT,
  last_error          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================================================================
-- INFRASTRUCTURE AND HISTORY
-- Things a file on disk cannot do at all.
-- ===========================================================================

-- Sessions live in a memory map today, so restarting the backend signs everyone out and
-- two servers could never share them. The token itself is never stored, only its hash:
-- if the database leaks, the sessions in it cannot be used.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT
);

-- One snapshot per day per plant. This is what turns the tile sparklines from illustrative
-- shapes into measured history.
CREATE TABLE daily_metrics (
  id           INTEGER PRIMARY KEY,
  captured_on  TEXT NOT NULL,
  plant_id     INTEGER REFERENCES plants(id),
  metric       TEXT NOT NULL,
  value        REAL NOT NULL,
  UNIQUE (captured_on, plant_id, metric)
);

-- ===========================================================================
-- INDEXES
-- Only where a query actually filters or sorts. An index nobody uses still costs time on
-- every insert, so these are deliberately few.
-- ===========================================================================

CREATE INDEX idx_documents_status_plant  ON purchase_documents (status, plant_id);
CREATE INDEX idx_documents_vendor        ON purchase_documents (vendor_id);
CREATE INDEX idx_documents_contract      ON purchase_documents (contract_id);
CREATE INDEX idx_items_document          ON purchase_document_items (document_id);
CREATE INDEX idx_steps_document          ON approval_steps (document_id);
CREATE INDEX idx_material_plants_plant   ON material_plants (plant_id);
CREATE INDEX idx_demands_material_plant  ON material_demands (material_plant_id);
CREATE INDEX idx_deliveries_vendor       ON vendor_deliveries (vendor_id, sequence);
CREATE INDEX idx_situations_status_plant ON situations (status, plant_id);
CREATE INDEX idx_evidence_situation      ON situation_evidence (situation_id);
CREATE INDEX idx_action_log_time         ON action_log (occurred_at DESC);
CREATE INDEX idx_sessions_expiry         ON sessions (expires_at);
CREATE INDEX idx_metrics_lookup          ON daily_metrics (metric, captured_on);
