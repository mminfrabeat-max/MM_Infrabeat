// Everything the manager can actually DO: approve, send back, clear a problem, raise a
// request, and write a mail.
//
// One rule runs through all of them, and the order of operations enforces it:
//
//   1. Write the change to the store
//   2. Then try to send the email
//   3. Then record how the email went
//
// Saving first means a mail failure can never lose a decision. The reverse order could
// leave you having emailed a vendor about an approval that was never recorded.
//
// Where the change is saved depends on DATA_SOURCE, and this file does not know or care.
// With the database it is one transaction; with the workbook it is a sequence. store.js
// holds that difference.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getDocuments, getSituations, getStock, getSupplierScores } from '../data-service.js';
import * as store from '../store.js';
import { sendDecisionEmail, sendInitiatorEmail, sendPlainEmail } from '../mailer.js';
import { canDecide, outcomeOf, outcomeSentence, whoseTurn } from '../domain/approvals.js';
import { chainFor, nextDocumentNumber } from '../domain/creation.js';
import { canAdvanceTo, LAST_STAGE } from '../domain/shipment.js';
import { readIntent } from '../domain/ask.js';
import { recipientFor, maskedAddress } from '../domain/recipients.js';
import { config } from '../config.js';

export const actionsRouter = Router();

function requireWritableSource(res) {
  if (!store.canWrite()) {
    res.status(409).json({
      error:
        `Changes cannot be saved with DATA_SOURCE="${config.dataSource}". ` +
        `Set it to "db" for SQLite or "excel" for the workbook, then restart the backend.`
    });
    return false;
  }
  return true;
}

function stamp() {
  return new Date().toLocaleString('en-IN');
}

// Strips the recipient address off a mail result before it goes to the browser.
//
// `delivered` is what is left, and it is the part that matters on screen: true means it
// reached the person named, false means there was no mailbox on file and it came back to
// the operator instead. Both are worth saying; neither needs an address to say it.
function withoutAddress(mail) {
  if (!mail) return mail;
  const { to, preview, ...rest } = mail;
  return rest;
}

// --- Approve and send back ---------------------------------------------------

async function decide(req, res, action) {
  if (!requireWritableSource(res)) return;

  const documentId = req.params.id;
  const note = String(req.body?.note || '').trim();
  const documents = await getDocuments();
  const document = documents.find((d) => d.id === documentId);

  if (!document) {
    return res.status(404).json({ error: `No document found with the number ${documentId}.` });
  }

  // Guards against a double click, a stale browser tab, or two people acting at once.
  //
  // Only a document that is finished with lands here now. One that has moved on to the next
  // approver is still open to a decision - the manager records theirs - so it passes the
  // guard rather than being refused by it.
  if (!canDecide(document)) {
    return res.status(409).json({
      error: `${documentId} was already ${document.status}${
        document.decidedBy ? ` by ${document.decidedBy}` : ''
      }. Refresh to see the current position.`
    });
  }

  // Whose decision this is.
  //
  // Usually the manager's own. On a document they have already signed it is the approver
  // it moved to, whose decision they are recording - so the step is stamped with THAT
  // name. It is worked out here, after the document has been found and checked, because
  // it is a fact about the document rather than about the request.
  const actingFor = whoseTurn(document, req.user.name);
  const decidedBy = actingFor.name;
  // The mailbox a reply goes to is always the person at the keyboard, whoever the
  // decision belongs to: they are the one who can answer a question about it. Never taken
  // from the request body - if the browser could say who approved something, anyone could
  // approve as anyone.
  const decidedByAddress = req.user.username;

  // The one decision this route is really making. Everything below carries it out.
  const outcome = outcomeOf(document, action);
  const at = stamp();
  const sentence = outcomeSentence(document, outcome, decidedBy);

  // Both mails are attempted before the save so their outcome can be recorded in the same
  // transaction. Neither throws; each returns a status string instead, so no mail failure
  // can stop the decision being saved a moment later.
  //
  // They go together rather than one after the other. Each waits up to fifteen seconds on a
  // slow mail server, and nobody should sit in front of a "Saving..." button for thirty.
  const [mail, initiatorMail] = await Promise.all([
    // To the next approver when there is one, otherwise the record copy as before.
    sendDecisionEmail({
      document,
      decision: outcome.final ? outcome.status : 'approved',
      decidedBy,
      decidedByAddress,
      note,
      movedTo: outcome.movedTo
    }),
    // To whoever raised it, every time, whatever the outcome.
    sendInitiatorEmail({ document, outcome, decidedBy, note, sentence })
  ]);

  await store.saveDecision({
    documentId,
    status: outcome.status,
    decidedBy,
    decidedByAddress,
    decidedAt: at,
    note,
    document,
    mail,
    outcome,
    initiatorMail
  });

  res.json({
    status: outcome.status,
    final: outcome.final,
    movedTo: outcome.movedTo,
    step: outcome.step,
    sentence,
    documentId,
    decidedBy,
    decidedAt: at,
    saved: true,
    // Whether each mail left, and whether it reached the person it names - but never the
    // address. The screen has a name to show; the browser has no business knowing mailboxes.
    email: withoutAddress(mail),
    initiatorEmail: withoutAddress(initiatorMail)
  });
}

// POST /api/approvals/:id/approve   { note }
actionsRouter.post('/approvals/:id/approve', asyncHandler((req, res) => decide(req, res, 'approve')));

// POST /api/approvals/:id/reject    { note }
actionsRouter.post('/approvals/:id/reject', asyncHandler((req, res) => decide(req, res, 'reject')));

// --- Clearing a problem ------------------------------------------------------

// POST /api/situations/:id/fix
actionsRouter.post(
  '/situations/:id/fix',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const situations = await getSituations();
    const situation = situations.find((s) => s.id === req.params.id);

    if (!situation) {
      return res.status(404).json({ error: `No problem found with reference ${req.params.id}.` });
    }
    if (situation.status !== 'open') {
      return res.status(409).json({ error: `${situation.id} has already been handled.` });
    }

    const at = stamp();
    await store.saveSituationFix({
      reference: situation.id,
      relatedTo: situation.relatedTo,
      fix: situation.fix,
      fixedAt: at,
      fixedBy: req.user.name,
      fixedByAddress: req.user.username
    });

    res.json({ id: situation.id, status: 'fixed', fixedAt: at, fix: situation.fix });
  })
);

// --- Raising a request against a short material ------------------------------

// POST /api/materials/:code/request   { plant }
actionsRouter.post(
  '/materials/:code/request',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const plant = String(req.body?.plant || '').trim();
    const materials = await getStock();
    const material = materials.find((m) => m.code === req.params.code && m.plant === plant);

    if (!material) {
      return res.status(404).json({ error: `${req.params.code} is not held at ${plant || 'that plant'}.` });
    }
    if (material.suggestedOrderQuantity <= 0) {
      return res.status(409).json({ error: `${material.name} at ${plant} does not need an order right now.` });
    }

    const quantity = material.suggestedOrderQuantity;
    const at = stamp();

    await store.saveStockRequest({
      materialCode: material.code,
      plant: material.plant,
      quantity,
      unit: material.unit,
      materialName: material.name,
      supplierName: material.supplierName,
      newOpenOrderQuantity: material.openOrderQuantity + quantity,
      raisedAt: at,
      raisedBy: req.user.name,
      raisedByAddress: req.user.username
    });

    res.json({ code: material.code, plant: material.plant, quantity, unit: material.unit, raisedAt: at });
  })
);

// --- Raising a requisition ----------------------------------------------------

// POST /api/requisitions   { materialCode, plant, quantity, neededBy, reason, raisedBy }
//
// The other half of the stock screen's "raise request" button, and the thing it never did.
// That button moved a number and wrote a log line; this creates an actual requisition, with
// a number, an approval chain and a place in the queue.
//
// The rate comes from the material's own record rather than from the browser. A price
// posted by a client is a price anybody can choose, and it decides the value, which decides
// who has to approve it.
actionsRouter.post(
  '/requisitions',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const materialCode = String(req.body?.materialCode || '').trim();
    const plant = String(req.body?.plant || '').trim();
    const quantity = Number(req.body?.quantity);
    const neededBy = String(req.body?.neededBy || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const raisedByName = String(req.body?.raisedBy || '').trim() || req.user.name;

    if (!materialCode || !plant) {
      return res.status(400).json({ error: 'A requisition needs a material and a plant.' });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a number greater than zero.' });
    }

    const materials = await getStock();
    const material = materials.find((m) => m.code === materialCode && m.plant === plant);
    if (!material) {
      return res.status(404).json({ error: `${materialCode} is not held at ${plant}.` });
    }

    // A material's record holds how much there is, not what it costs: the rate lives on the
    // documents it has been bought on. So the last rate paid for it is the estimate, and a
    // buyer who knows better can say so on the form.
    //
    // It matters more than an estimate usually would, because the value decides the
    // approval chain. A requisition priced at nothing would route as if it were free.
    const documents = await getDocuments();
    const lastBuy = documents
      .filter((d) => d.materialCode === material.code && Number(d.rate) > 0)
      .sort((a, b) => Number(b.rate) - Number(a.rate))[0];

    const typedRate = Number(req.body?.rate);
    const rate = Number.isFinite(typedRate) && typedRate > 0 ? Math.round(typedRate) : Number(lastBuy?.rate) || 0;

    if (rate <= 0) {
      return res.status(400).json({
        error:
          `There is no rate on file for ${material.name}, so its value cannot be worked out. ` +
          `Enter an estimated rate per ${material.unit || 'unit'} and raise it again.`
      });
    }

    const basic = Math.round(quantity * rate);
    const chain = chainFor({ kind: 'PR', basic });

    const used = await store.usedDocumentNumbers();
    const id = nextDocumentNumber('PR', used);
    const at = stamp();

    const document = {
      id,
      kind: 'PR',
      docType: 'Purchase requisition',
      trade: 'Domestic',
      incoterm: '',
      supplierId: lastBuy?.supplierId || '',
      material: material.name,
      materialCode: material.code,
      plant,
      quantity,
      unit: material.unit || '',
      rate,
      basic,
      freight: 0,
      loading: 0,
      transport: '',
      payTerms: '',
      cashDiscount: '',
      rebate: '',
      deliveryDate: neededBy,
      reason,
      department: 'Central procurement'
    };

    await store.createDocument({
      document,
      item: {
        documentId: id,
        pos: 10,
        materialCode: material.code,
        material: material.name,
        quantity,
        unit: material.unit || '',
        rate
      },
      chain: { step: chain.step, next: chain.next, approverName: req.user.name },
      raisedBy: { name: raisedByName, title: 'Buyer, Procurement', when: at },
      // The row that makes it visible as an open request. The workbook needs it; SQLite
      // works this out from the document itself.
      openRequest: {
        id,
        dept: 'Central procurement',
        plant,
        material: material.name,
        value: basic,
        ageDays: 0,
        note: reason || `${quantity} ${material.unit || ''} for ${plant}`.trim()
      }
    });

    await store
      .saveMail({
        to: '',
        subject: `Requisition ${id} raised for ${material.name}`,
        body: reason,
        sentAt: at,
        sentBy: req.user.name,
        sentByAddress: req.user.username,
        mail: { status: 'not a message, a record of the requisition being raised' }
      })
      .catch(() => {});

    res.json({
      id,
      kind: 'PR',
      material: material.name,
      quantity,
      unit: material.unit || '',
      plant,
      basic,
      step: chain.step,
      next: chain.next,
      raisedBy: raisedByName,
      raisedAt: at
    });
  })
);

// --- Raising a purchase order --------------------------------------------------

// POST /api/orders
//   { fromRequisition?, materialCode?, plant?, quantity?, supplierId, rate?,
//     freight?, loading?, incoterm?, transport?, payTerms?, deliveryDate? }
//
// The second step of the cycle. An order can be raised on its own, but the ordinary way
// in is to convert a requisition that has finished its approvals: the material, plant and
// quantity come across from it, and the order records which requisition it came from.
//
// That link is what stops one requisition quietly becoming two orders. A requisition says
// something is needed once, and nothing in a spreadsheet would otherwise notice it being
// spent twice.
actionsRouter.post(
  '/orders',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const documents = await getDocuments();
    const fromRequisition = String(req.body?.fromRequisition || '').trim();

    let source = null;
    if (fromRequisition) {
      source = documents.find((d) => d.id === fromRequisition);
      if (!source) {
        return res.status(404).json({ error: `There is no requisition numbered ${fromRequisition}.` });
      }
      if (source.kind !== 'PR') {
        return res.status(409).json({ error: `${fromRequisition} is a ${source.kind}, not a requisition.` });
      }
      if (source.status !== 'approved') {
        return res.status(409).json({
          error:
            source.status === 'rejected'
              ? `${fromRequisition} was sent back, so it cannot become an order.`
              : `${fromRequisition} has not finished its approvals yet, so it cannot become an order.`
        });
      }
      const already = documents.find((d) => d.sourceDocument === fromRequisition);
      if (already) {
        return res.status(409).json({
          error: `${fromRequisition} has already been converted into order ${already.id}.`
        });
      }
    }

    const materialCode = String(req.body?.materialCode || source?.materialCode || '').trim();
    const plant = String(req.body?.plant || source?.plant || '').trim();
    const quantity = Number(req.body?.quantity ?? source?.quantity);
    const supplierId = String(req.body?.supplierId || '').trim();

    if (!materialCode || !plant) {
      return res.status(400).json({ error: 'An order needs a material and a plant.' });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a number greater than zero.' });
    }
    // A requisition asks; an order commits. Committing needs somebody to commit to.
    if (!supplierId) {
      return res
        .status(400)
        .json({ error: 'An order needs a vendor. A requisition can go without one, an order cannot.' });
    }

    const vendors = await getSupplierScores();
    const vendor = vendors[supplierId];
    if (!vendor) {
      return res.status(404).json({ error: `There is no vendor with the code ${supplierId}.` });
    }

    const materials = await getStock();
    const material = materials.find((m) => m.code === materialCode && m.plant === plant);
    const materialName = material?.name || source?.material || materialCode;
    const unit = material?.unit || source?.unit || vendor.unit || '';

    // Contract rate first, because that is the price actually agreed with this vendor.
    // Then what the requisition estimated, then the last rate paid for the material.
    const typedRate = Number(req.body?.rate);
    const lastBuy = documents
      .filter((d) => d.materialCode === materialCode && Number(d.rate) > 0)
      .sort((a, b) => Number(b.rate) - Number(a.rate))[0];
    const rate =
      Number.isFinite(typedRate) && typedRate > 0
        ? Math.round(typedRate)
        : Number(vendor.contractRate) || Number(source?.rate) || Number(lastBuy?.rate) || 0;

    if (rate <= 0) {
      return res.status(400).json({
        error:
          `There is no rate on file for ${materialName} with ${vendor.name}. ` +
          `Enter a rate per ${unit || 'unit'}.`
      });
    }

    const freight = Math.max(0, Math.round(Number(req.body?.freight) || 0));
    const loading = Math.max(0, Math.round(Number(req.body?.loading) || 0));
    const basic = Math.round(quantity * rate);
    const chain = chainFor({ kind: 'PO', basic });

    const used = await store.usedDocumentNumbers();
    const id = nextDocumentNumber('PO', used);
    const at = stamp();

    const document = {
      id,
      kind: 'PO',
      docType: 'Standard purchase order',
      trade: vendor.category && /import/i.test(vendor.category) ? 'Import' : 'Domestic',
      incoterm: String(req.body?.incoterm || '').trim(),
      supplierId,
      material: materialName,
      materialCode,
      plant,
      quantity,
      unit,
      rate,
      basic,
      freight,
      loading,
      transport: String(req.body?.transport || '').trim(),
      payTerms: String(req.body?.payTerms || '').trim(),
      cashDiscount: '',
      rebate: '',
      deliveryDate: String(req.body?.deliveryDate || source?.deliveryDate || '').trim(),
      reason: fromRequisition ? `Converted from requisition ${fromRequisition}` : '',
      department: 'Central procurement',
      sourceDocument: fromRequisition || ''
    };

    await store.createDocument({
      document,
      item: { documentId: id, pos: 10, materialCode, material: materialName, quantity, unit, rate },
      chain: { step: chain.step, next: chain.next, approverName: req.user.name },
      // An order converted from a requisition belongs to whoever asked for it, not to
      // whoever pressed the button. They are the person who needs to hear what happens.
      raisedBy: source?.createdBy
        ? { name: source.createdBy.name, title: source.createdBy.title || '', when: at }
        : { name: req.user.name, title: 'Procurement Manager', when: at }
    });

    res.json({
      id,
      kind: 'PO',
      material: materialName,
      quantity,
      unit,
      plant,
      vendor: vendor.name,
      rate,
      basic,
      total: basic + freight + loading,
      step: chain.step,
      next: chain.next,
      fromRequisition: fromRequisition || null,
      raisedAt: at
    });
  })
);

// --- Where the goods are -------------------------------------------------------

// POST /api/shipments/:id/advance   { stage?, note? }
//
// Moves a released order one step along. `stage` is optional and is checked rather than
// obeyed: sending it lets a stale screen say which move it thought it was making, and the
// rule refuses if that is no longer the next one. Without it the order simply advances.
//
// Nothing is mailed. Every other action here tells somebody something; this one records
// what a vendor or a gate clerk has already done, and the people who would be told are
// the ones who told us.
actionsRouter.post(
  '/shipments/:id/advance',
  asyncHandler(async (req, res) => {
    if (!requireWritableSource(res)) return;

    const documents = await getDocuments();
    const document = documents.find((d) => d.id === req.params.id);
    if (!document) {
      return res.status(404).json({ error: `No document found with the number ${req.params.id}.` });
    }

    const wanted = String(req.body?.stage || '').trim();
    const verdict = canAdvanceTo(document, wanted || null);
    if (!verdict.ok) {
      return res.status(409).json({ error: verdict.why });
    }

    const at = stamp();
    const note = String(req.body?.note || '').trim();

    await store.saveShipmentStage({
      documentId: document.id,
      document,
      stage: verdict.stage.key,
      at,
      note,
      actionLabel: verdict.stage.label.toLowerCase(),
      recordedBy: req.user.name,
      recordedByAddress: req.user.username
    });

    res.json({
      id: document.id,
      stage: verdict.stage.key,
      label: verdict.stage.label,
      describe: verdict.stage.describe,
      at,
      complete: verdict.stage.key === LAST_STAGE
    });
  })
);

// --- Ask -----------------------------------------------------------------------

// POST /api/ask   { question, plant }
//
// Answers a question, or offers to do something. It never does it.
//
// A proposal comes back describing the action in words plus the ordinary endpoint that
// would carry it out - the same one the buttons use. The browser shows it, the person
// confirms, and the confirm is an ordinary authenticated request like any other. Ask has
// no private way into the store, so the worst a misread question can cost is a click.
//
// This is a POST rather than a GET because the question is a body, and because a URL that
// reads "?question=approve 4500178401" is the kind of thing that ends up in a log, a
// browser history and a bookmark.
actionsRouter.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const question = String(req.body?.question || '').trim();
    const plant = String(req.body?.plant || 'all').trim();
    // What was being talked about a moment ago, sent back by the browser.
    //
    // Held there rather than here on purpose: the server stays stateless, two people
    // cannot end up sharing a train of thought, and nothing has to be expired. It carries
    // no authority - only which material or document was last named - so a browser that
    // tampers with it can at most confuse itself.
    const memory = req.body?.memory && typeof req.body.memory === 'object' ? req.body.memory : {};

    if (question.length > 500) {
      return res.status(400).json({ error: 'That is longer than I can read. Ask me something shorter.' });
    }

    const [documents, materials, vendors] = await Promise.all([
      getDocuments(),
      getStock(),
      getSupplierScores()
    ]);

    // Filtered the same way the screens are, so an answer matches what is on them.
    const inPlant = (rows) => (plant === 'all' ? rows : rows.filter((r) => !r.plant || r.plant === plant));

    const result = readIntent(question, {
      documents: inPlant(documents),
      materials: inPlant(materials),
      vendors: Object.values(vendors),
      plant,
      manager: req.user.name,
      memory
    });

    // A proposal that would write anything is refused outright against a read-only source,
    // rather than offered and failing at the confirm - which would read as the dashboard
    // changing its mind.
    if (result.kind === 'proposal' && !store.canWrite()) {
      return res.json({
        kind: 'answer',
        text:
          `I can tell you about ${result.summary.toLowerCase()}, but nothing can be saved with ` +
          `DATA_SOURCE="${config.dataSource}". Set it to "excel" or "db" and restart the backend.`
      });
    }

    res.json(result);
  })
);

// --- Writing a mail ----------------------------------------------------------

// POST /api/mail   { toName, to, subject, body }
//
// Two ways to say who it goes to, and the order matters.
//
// `toName` is a person named on the dashboard, and their address is looked up HERE. The
// browser is never told what it is. That is the whole reason this lookup is on the server:
// the directory holds real people's personal mailboxes, and anything sent to a browser is
// readable by anyone holding that browser.
//
// `to` is an address the person at the keyboard typed themselves. That is theirs to decide,
// so it is accepted as given, and it wins if both are present.
actionsRouter.post(
  '/mail',
  asyncHandler(async (req, res) => {
    const typed = String(req.body?.to || '').trim();
    const toName = String(req.body?.toName || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();

    const resolved = typed ? { address: typed, real: true, name: '' } : recipientFor(toName);

    // Somebody with no mailbox on file resolves to no address at all, rather than to a
    // guess. The message still goes out, to the operator, saying at the top who it was for.
    // Refusing to send would lose what they wrote; guessing an address would bounce it.
    const to = resolved.address || config.mail.to || config.mail.user;
    const redirected = Boolean(resolved.name) && !resolved.real;

    if (!to || !subject) {
      return res.status(400).json({ error: 'A mail needs at least a recipient and a subject.' });
    }

    const mail = await sendPlainEmail({
      to,
      subject,
      body: redirected
        ? `[Meant for ${resolved.name}. There is no mailbox on file for them, so this came ` +
          `to you instead. Add them to MAIL_DIRECTORY in .env to have it delivered.]\n\n${body}`
        : body,
      from: req.user.username
    });

    await store
      .saveMail({ to, subject, body, sentAt: stamp(), sentBy: req.user.name, sentByAddress: req.user.username, mail })
      .catch((error) => console.error('[api] mail sent but not logged:', error.message));

    // The address is deliberately not returned. The screen says who it went to by name, and
    // sending it back here would put the directory into the browser through the back door -
    // the exact thing moving the lookup was meant to stop.
    //
    // `deliverable` is what the screen actually needs: whether that person has a real
    // mailbox on file, or whether this one is going to bounce.
    res.json({ ...mail, to: undefined, deliverable: resolved.real, toName: resolved.name || undefined });
  })
);

// --- Looking up one address, on demand ---------------------------------------

// GET /api/contact/address?name=Mr.%20Anil%20Deshmukh
//
// Answers "where would a mail to this person go", for the To box of the compose window.
//
// One name per request, when somebody opens the window, rather than the whole directory
// riding along inside /api/dashboard. The difference is what ends up copied: the dashboard
// payload is held in the page for the whole session and is what the shareable offline file
// is built from, so an address in there is an address in both. This one exists for as long
// as the compose window is open, and only for the person being written to.
actionsRouter.get(
  '/contact/address',
  asyncHandler(async (req, res) => {
    const person = recipientFor(String(req.query.name || ''));
    res.json({ name: person.name, address: person.address, deliverable: person.real });
  })
);

// --- Reaching somebody on Teams ----------------------------------------------

// GET /api/contact/teams?name=Mr.%20Anil%20Deshmukh&mode=chat|call
//
// Redirects to a Microsoft Teams deep link for that person. It is a redirect rather than a
// link the browser builds itself for the same reason everything else here is: the deep link
// has to carry an address, and building it in the page would put the whole directory back
// into the bundle and into the shareable offline copy.
//
// This way the address exists only in the Location header of one response, sent when
// somebody actually clicks. Nothing is stored in the page.
actionsRouter.get(
  '/contact/teams',
  asyncHandler(async (req, res) => {
    const person = recipientFor(String(req.query.name || ''));
    const mode = req.query.mode === 'call' ? 'call' : 'chat';

    if (!person.address) {
      return res.status(404).json({
        error: `There is no mailbox on file for ${person.name || 'that person'}, so Teams has nobody to open. Add them to MAIL_DIRECTORY in .env.`
      });
    }

    const link =
      mode === 'call'
        ? `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(person.address)}`
        : `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(person.address)}`;

    // 302 rather than 301: which mailbox a name maps to is a setting, and a permanent
    // redirect would be cached by the browser long after that setting changed.
    res.redirect(302, link);
  })
);

// --- The audit trail ---------------------------------------------------------

// GET /api/action-log
//
// The stored log keeps the exact address every mail went to, which is what an audit trail is
// for. This response does not, because it has two readers that the workbook does not: the
// browser, and the offline HTML file, which bakes whatever this returns into a document
// people pass around. A colleague's personal mailbox does not belong in either.
//
// So the address is masked on the way out. The full record stays on the server for anyone
// who needs to answer "where exactly did that go".
actionsRouter.get(
  '/action-log',
  asyncHandler(async (req, res) => {
    const entries = (await store.readActionLog()).map((entry) => ({
      ...entry,
      emailTo: maskedAddress(entry.emailTo)
    }));
    res.json({ entries, available: store.canWrite() });
  })
);

