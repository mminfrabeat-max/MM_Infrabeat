// The SQLite data source.
//
// It keeps exactly the same promise as the mock and Excel providers, which is the whole
// point of the provider pattern: no domain rule, no route and no screen changes because
// the data moved into a database.
//
// The shapes it returns are the business shapes from provider.js, not table rows. Three
// jobs happen on the way out:
//
//   - Rows join back into objects. A document collects its item lines, its approval chain
//     and its shipment, the same way excel-store.js reassembles them from separate sheets.
//   - 0 and 1 become true and false, because SQLite has no boolean type.
//   - Open orders and unconverted requests are filtered out of getPurchaseDocuments and
//     returned by getCommitments instead. They are all rows in purchase_documents; the
//     status column is what separates them. One table, three questions.

import { all, toBool } from '../db.js';

// --- Vendors ------------------------------------------------------------------

export const dbProvider = {
  name: 'db',

  async getSuppliers() {
    return all(
      `SELECT code, name, category, city, gst_number, import_code, sap_score, contract_rate, unit
         FROM vendors
        ORDER BY name`
    ).map((r) => ({
      id: r.code,
      name: r.name,
      category: r.category,
      city: r.city,
      gst: r.gst_number,
      iec: r.import_code || null,
      sapScore: r.sap_score,
      contractRate: r.contract_rate,
      unit: r.unit
    }));
  },

  // The rest of the backend wants history grouped by vendor, so the grouping happens here
  // rather than in a dozen queries.
  async getSupplierHistory() {
    const rows = all(
      `SELECT v.code, d.order_number, d.delivered_month, d.days_late, d.quality_percent, d.rate
         FROM vendor_deliveries d
         JOIN vendors v ON v.id = d.vendor_id
        ORDER BY v.code, d.sequence`
    );

    const byVendor = {};
    for (const r of rows) {
      if (!byVendor[r.code]) byVendor[r.code] = [];
      byVendor[r.code].push({
        order: r.order_number,
        month: r.delivered_month,
        daysLate: r.days_late,
        qualityPercent: r.quality_percent,
        rate: r.rate
      });
    }
    return byVendor;
  },

  // --- Purchase documents -----------------------------------------------------

  async getPurchaseDocuments() {
    const documents = all(
      `SELECT d.*, v.code AS vendor_code, p.name AS plant_name, u.email AS decided_by_email,
              decider.full_name AS decided_by_full_name,
              -- Who actually signed, taken from the step they closed. The login behind a
              -- decision need not have a person record, but the step always carries the
              -- name that was recorded at the time - and an audit trail should read as the
              -- name of a person, not as somebody's account.
              (SELECT st.approver_name
                 FROM approval_steps st
                WHERE st.document_id = d.id AND st.acted_at IS NOT NULL
                ORDER BY st.step_number DESC
                LIMIT 1) AS decided_by_step_name,
              raiser.full_name AS raised_by_full_name,
              raiser.job_title AS raised_by_title
         FROM purchase_documents d
         LEFT JOIN vendors v ON v.id = d.vendor_id
         LEFT JOIN plants  p ON p.id = d.plant_id
         LEFT JOIN users   u ON u.id = d.decided_by_user_id
         LEFT JOIN people  decider ON decider.id = u.person_id
         LEFT JOIN people  raiser ON raiser.id = d.created_by_person_id
        WHERE d.status IN ('pending', 'approved', 'rejected')
        ORDER BY d.hours_waiting DESC`
    );

    if (documents.length === 0) return [];

    const ids = documents.map((d) => d.id);
    const holes = ids.map(() => '?').join(',');

    // Three queries for the children rather than three per document. With five documents
    // it makes no difference; with five thousand it is the difference between a page that
    // loads and one that does not.
    const items = all(
      `SELECT * FROM purchase_document_items WHERE document_id IN (${holes}) ORDER BY position`,
      ids
    );
    const steps = all(
      `SELECT * FROM approval_steps WHERE document_id IN (${holes}) ORDER BY step_number`,
      ids
    );
    const shipments = all(`SELECT * FROM shipments WHERE document_id IN (${holes})`, ids);

    const itemsByDocument = groupBy(items, 'document_id');
    const stepsByDocument = groupBy(steps, 'document_id');
    const shipmentByDocument = new Map(shipments.map((s) => [s.document_id, s]));

    return documents.map((d) => {
      const lines = (itemsByDocument.get(d.id) || []).map((i) => ({
        pos: i.position,
        materialCode: i.material_code,
        material: i.description,
        type: i.material_type || '',
        typeText: i.type_text || '',
        group: i.material_group || '',
        groupText: i.group_text || '',
        quantity: i.quantity,
        unit: i.unit,
        rate: i.rate
      }));

      // The header quantity, unit and rate are the first line's. Deriving them rather than
      // storing them again is what stops the two disagreeing after somebody edits a line.
      const first = lines[0] || { quantity: 0, unit: '', rate: 0 };

      // The chain, in step order. Three questions are answered from it.
      const chain = stepsByDocument.get(d.id) || [];

      // The previous approver is the earliest step already signed off.
      const approved = chain.filter((s) => s.status === 'approved');
      const prev = approved.length
        ? {
            name: approved[0].approver_name,
            level: approved[0].step_label,
            when: approved[0].acted_at,
            note: approved[0].note
          }
        : null;

      // Steps still waiting, in order. Normally the first of them is whoever holds the
      // document right now and the second is where it goes after they sign.
      //
      // Once this manager has signed a document that is not the last step, the document is
      // still pending but its own step is closed - so the first waiting step has become the
      // next approver rather than the current holder. decided_at on a pending document is
      // what distinguishes the two cases, and it is the only place that distinction lives.
      const waiting = chain.filter((s) => s.status === 'waiting');
      const movedOn = Boolean(d.decided_at) && d.status === 'pending';
      const upcoming = movedOn ? waiting[0] : waiting[1];

      const next = upcoming
        ? {
            name: upcoming.approver_name,
            title: upcoming.approver_title,
            level: upcoming.step_label
          }
        : null;

      const ship = shipmentByDocument.get(d.id);

      return {
        id: d.doc_number,
        kind: d.kind,
        docType: d.doc_type || '',
        trade: d.trade || 'Domestic',
        incoterm: d.incoterm || '',
        supplierId: d.vendor_code || '',
        material: lines[0]?.material || '',
        materialCode: lines[0]?.materialCode || '',
        plant: d.plant_name || '',
        quantity: first.quantity,
        unit: first.unit,
        rate: first.rate,
        basic: d.basic_value,
        freight: d.freight,
        loading: d.loading,
        transport: d.transport || '',
        payTerms: d.pay_terms || '',
        cashDiscount: d.cash_discount || '',
        rebate: d.rebate || '',
        deliveryDate: d.delivery_date || '',
        hoursWaiting: d.hours_waiting,
        step: d.current_step || '',
        reason: d.blocked_reason || '',
        items: lines,
        createdBy: d.created_by_name
          ? {
              name: d.raised_by_full_name || d.created_by_name,
              title: d.raised_by_title || '',
              when: d.raised_on || ''
            }
          : null,
        prev,
        next,
        vessel: ship
          ? {
              name: ship.vessel_name,
              imo: ship.imo_number,
              billOfLading: ship.bill_of_lading,
              from: ship.origin_port,
              to: ship.destination_port,
              position: ship.position_text,
              eta: ship.eta,
              afterPort: ship.inland_note,
              updated: ship.position_at,
              source: ship.feed_source
            }
          : null,
        status: d.status,
        // The name, as the workbook records it. The address is the last resort, for a
        // login with neither a signed step nor a person record behind it.
        decidedBy: d.decided_by_step_name || d.decided_by_full_name || d.decided_by_email || '',
        decidedAt: d.decided_at || '',
        // The requisition this order came from, empty on anything raised directly.
        sourceDocument: d.source_doc_number || '',
        shipmentStage: d.shipment_stage || '',
        shipmentStageAt: d.shipment_stage_at || '',
        shipmentNote: d.shipment_note || '',
        decisionNote: d.decision_note || ''
      };
    });
  },

  // --- Materials --------------------------------------------------------------

  async getMaterials() {
    const rows = all(
      `SELECT mp.id, m.code, m.name, p.name AS plant_name, mp.on_hand, m.base_unit,
              mp.safety_stock, mp.reorder_point, mp.open_order_qty, mp.daily_usage,
              mp.lead_time_days, mp.is_kiln_critical, mp.default_vendor_name
         FROM material_plants mp
         JOIN materials m ON m.id = mp.material_id
         JOIN plants    p ON p.id = mp.plant_id
        ORDER BY m.code`
    );

    const demands = all(
      `SELECT material_plant_id, department, quantity, needed_by, requested_by_name
         FROM material_demands
        ORDER BY quantity DESC`
    );
    const demandsByMaterialPlant = groupBy(demands, 'material_plant_id');

    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      plant: r.plant_name,
      onHand: r.on_hand,
      unit: r.base_unit,
      safetyStock: r.safety_stock,
      reorderPoint: r.reorder_point,
      openOrderQuantity: r.open_order_qty,
      dailyUsage: r.daily_usage,
      leadTimeDays: r.lead_time_days,
      kiln: toBool(r.is_kiln_critical),
      supplierName: r.default_vendor_name || '',
      needs: (demandsByMaterialPlant.get(r.id) || []).map((d) => ({
        dept: d.department,
        quantity: d.quantity,
        by: d.needed_by,
        who: d.requested_by_name || ''
      }))
    }));
  },

  // --- Situations --------------------------------------------------------------

  async getSituations() {
    const rows = all(
      `SELECT s.*, p.name AS plant_name
         FROM situations s
         LEFT JOIN plants p ON p.id = s.plant_id
        ORDER BY s.reference`
    );
    if (rows.length === 0) return [];

    const evidence = all(
      `SELECT situation_id, evidence FROM situation_evidence ORDER BY situation_id, sequence`
    );
    const evidenceBySituation = groupBy(evidence, 'situation_id');

    return rows.map((s) => ({
      id: s.reference,
      severity: s.severity,
      icon: s.icon || 'alert',
      category: s.category || '',
      title: s.title,
      where: s.where_text || '',
      plant: s.plant_name || '',
      relatedTo: s.related_to || '',
      detail: s.detail || '',
      who: s.who_text || '',
      stuck: s.stuck_where || '',
      call: s.call_to_make || '',
      speakTo: s.speak_to_name || '',
      followUp: s.follow_up || '',
      joined: (evidenceBySituation.get(s.id) || []).map((e) => e.evidence),
      fix: s.proposed_fix || '',
      canAutoFix: toBool(s.can_auto_fix),
      status: s.status
    }));
  },

  // --- Open orders, requests and contracts --------------------------------------

  async getCommitments() {
    const openOrders = all(
      `SELECT d.doc_number, d.basic_value, d.received_percent, d.note, d.ordered_on, d.due_on,
              v.name AS vendor_name, p.name AS plant_name,
              (SELECT description FROM purchase_document_items i
                WHERE i.document_id = d.id ORDER BY i.position LIMIT 1) AS material
         FROM purchase_documents d
         LEFT JOIN vendors v ON v.id = d.vendor_id
         LEFT JOIN plants  p ON p.id = d.plant_id
        WHERE d.status = 'open'
        ORDER BY d.due_on`
    ).map((r) => ({
      id: r.doc_number,
      supplierName: r.vendor_name || '',
      plant: r.plant_name || '',
      material: r.material || r.note || '',
      value: r.basic_value,
      ordered: r.ordered_on || '',
      due: r.due_on || '',
      receivedPercent: r.received_percent,
      note: r.note || ''
    }));

    const openRequests = all(
      `SELECT d.doc_number, d.department, d.basic_value, d.age_days, d.note, p.name AS plant_name
         FROM purchase_documents d
         LEFT JOIN plants p ON p.id = d.plant_id
        WHERE d.status = 'unconverted'
        ORDER BY d.age_days DESC`
    ).map((r) => ({
      id: r.doc_number,
      dept: r.department || '',
      plant: r.plant_name || '',
      material: r.note || '',
      value: r.basic_value,
      ageDays: r.age_days || 0,
      note: r.note || ''
    }));

    const contracts = all(
      `SELECT c.contract_number, c.covers, c.target_value, c.consumed_value, c.valid_to,
              c.days_left, v.name AS vendor_name, p.name AS plant_name
         FROM contracts c
         LEFT JOIN vendors v ON v.id = c.vendor_id
         LEFT JOIN plants  p ON p.id = c.plant_id
        ORDER BY c.days_left`
    ).map((r) => ({
      id: r.contract_number,
      supplierName: r.vendor_name || '',
      plant: r.plant_name || '',
      covers: r.covers || '',
      target: r.target_value,
      used: r.consumed_value,
      validTo: r.valid_to || '',
      daysLeft: r.days_left || 0
    }));

    return { openOrders, openRequests, contracts };
  },

  // --- Teams ---------------------------------------------------------------------

  async getTeams() {
    return all(
      `SELECT t.reference, t.name, t.headcount, t.doing_now, t.follow_up, t.tasks_open,
              t.tasks_done, t.mails_waiting, t.reply_time, t.last_seen, t.state,
              pe.full_name AS lead_name, pe.phone, p.name AS plant_name
         FROM teams t
         LEFT JOIN people pe ON pe.id = t.lead_person_id
         LEFT JOIN plants p  ON p.id = t.plant_id
        ORDER BY t.reference`
    ).map((r) => ({
      id: r.reference,
      name: r.name,
      lead: r.lead_name || '',
      people: r.headcount,
      plant: r.plant_name || '',
      phone: r.phone || '',
      now: r.doing_now || '',
      follow: r.follow_up || '',
      tasks: r.tasks_open,
      done: r.tasks_done,
      mailsWaiting: r.mails_waiting,
      replyTime: r.reply_time || '',
      lastSeen: r.last_seen || '',
      state: r.state
    }));
  }
};

// Groups rows by a column, so children can be attached to parents in one pass rather than
// filtering the whole array once per parent.
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}
