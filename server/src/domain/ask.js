// What the Ask box understands, and what it is allowed to do about it.
//
// This used to live in the browser, and for answering questions that was fine. It cannot
// stay there now that Ask can raise documents and approve them: anything the browser
// decides, the person holding the browser decides, and "approve this order" is not a
// decision a page should be able to make on its own.
//
// So the shape is: a question comes in, and exactly one of two things goes back.
//
//   an answer    - a fact about data the person can already see. Free, instant, harmless.
//   a proposal   - a description of an action, and the API call that would carry it out.
//                  NOTHING is written. The browser shows it, the person presses Confirm,
//                  and the confirm goes to the ordinary endpoint that already existed.
//
// That second part is the whole safety design, and it is deliberately boring: Ask has no
// private route to the store. It can only offer to do what you could already have done by
// hand, and a misread question costs a click rather than a released order.
//
// The intent parsing below is pattern matching. When a language model is put behind this,
// it replaces `readIntent` and nothing else - the tools, the proposals and the confirm step
// stay exactly as they are, which is why they are written as data rather than as code.

// money() is this project's rupee formatter - 'inr' is the browser-side name for it.
import { money as inr, plural } from './format.js';
import { canDecide, whoseTurn } from './approvals.js';
import { isTrackable, currentStage, nextStage, stageByKey } from './shipment.js';
import { recommendFor, verdictFor } from './vendor-choice.js';

// --- What Ask can do -----------------------------------------------------------
//
// Written out as a catalogue rather than as a chain of ifs, because it is the thing a
// language model will be handed later: each entry is already a name, a description and a
// set of arguments. Adding Claude means describing these to it, not rewriting them.

export const TOOLS = [
  { name: 'pending_approvals', writes: false, describe: 'What is waiting for the manager to approve.' },
  { name: 'find_document', writes: false, describe: 'Look up one purchase order or requisition by its number.' },
  { name: 'stock_position', writes: false, describe: 'Which materials are short, and by how much.' },
  { name: 'vendor_record', writes: false, describe: 'How a vendor has actually performed.' },
  { name: 'shipments', writes: false, describe: 'Where released orders have got to.' },
  { name: 'approve_document', writes: true, describe: 'Approve a document that is waiting.' },
  { name: 'reject_document', writes: true, describe: 'Send a document back.' },
  { name: 'advance_shipment', writes: true, describe: 'Record that a released order has moved a stage.' }
];

// --- Small helpers -------------------------------------------------------------

function plantIn(text) {
  if (/mumbai/i.test(text)) return 'Mumbai';
  if (/nagpur/i.test(text)) return 'Nagpur';
  if (/pune/i.test(text)) return 'Pune';
  return null;
}

function documentIn(text) {
  const found = /\b(45\d{8}|10\d{8}|46\d{8})\b/.exec(text);
  return found ? found[1] : null;
}

// Finds a material by code, or by enough of its name to be unambiguous.
function materialIn(text, materials) {
  const byCode = /\b([A-Z]{2}-\d{4})\b/i.exec(text);
  if (byCode) {
    const exact = materials.find((m) => m.code.toLowerCase() === byCode[1].toLowerCase());
    if (exact) return exact;
  }

  const lower = String(text).toLowerCase();
  // Longest name first, so "gypsum, imported" beats "gypsum" when both are present.
  const candidates = materials
    .filter((m) => lower.includes(String(m.name).toLowerCase().split(',')[0].trim()))
    .sort((a, b) => b.name.length - a.name.length);

  return candidates[0] || null;
}

function vendorIn(text, vendors) {
  const lower = String(text).toLowerCase();
  return (
    vendors.find((v) => lower.includes(String(v.name).toLowerCase())) ||
    vendors.find((v) => lower.includes(String(v.name).toLowerCase().split(' ')[0])) ||
    null
  );
}

// --- Answers -------------------------------------------------------------------

function answer(text, extra = {}) {
  return { kind: 'answer', text, ...extra };
}

// A proposal is a sentence a person can check, plus the call that would carry it out.
//
// `endpoint` and `body` are the ordinary API this dashboard already exposes - the same one
// the buttons use. Ask has no other way in, which is the point.
function proposal({ summary, detail, warning, endpoint, body, confirmLabel }) {
  return {
    kind: 'proposal',
    summary,
    detail: detail || [],
    warning: warning || null,
    confirmLabel: confirmLabel || 'Confirm',
    action: { endpoint, body }
  };
}

// --- The parser ----------------------------------------------------------------

// --- Remembering what is being talked about ------------------------------------
//
// Without this, every question starts from nothing and the box is a search bar with a
// personality. "Which vendor should I use?" only means something after "we are short on
// gypsum", and "approve it" only means something after the thing has been named.
//
// The memory is small and deliberately dumb: the last material, document and vendor
// mentioned, plus whatever the assistant last asked for. It is returned to the browser
// and sent back on the next question, so the server stays stateless - two people using
// the dashboard cannot end up sharing a train of thought, and nothing has to be expired.
export function nextMemory(question, context, result, expanded) {
  const memory = { ...(context.memory || {}) };
  const text = expanded || question;

  const document = documentIn(text);
  if (document) memory.documentId = document;

  const material = materialIn(text, context.materials || []);
  if (material) memory.materialCode = material.code;

  const vendor = vendorIn(text, context.vendors || []);
  if (vendor) memory.vendorId = vendor.supplierId;

  // What the assistant is waiting to be told, so a bare "400 MT" means something next time.
  memory.awaiting = result?.awaiting || null;

  return memory;
}

// Fills a short reply out into the question it stands for.
//
// People do not repeat themselves. Having just been told an order is waiting, nobody says
// "approve 4500178401" - they say "approve it". Rather than teach every branch below about
// pronouns, the question is expanded here and the parser goes on reading full sentences.
export function expand(question, context) {
  const memory = context.memory || {};
  const materials = context.materials || [];
  let q = String(question || '').trim();
  const lower = q.toLowerCase();

  // "approve it", "where is that one", "send it back"
  if (memory.documentId && !documentIn(q) && /\b(it|that|this|that one|the order|the document)\b/i.test(lower)) {
    q = `${q} ${memory.documentId}`;
  }

  // A question about a material without naming it again: "which vendor?", "how much is short?"
  if (memory.materialCode && !materialIn(q, materials)) {
    const material = materials.find((m) => m.code === memory.materialCode);
    if (material && /\b(vendor|supplier|who|buy|order|raise|short|stock|rate|price)\b/i.test(lower)) {
      q = `${q} ${material.code}`;
    }
  }

  return q;
}

// Reads a question and decides what is being asked for.
//
// Order matters here. Actions are tested before questions, because "approve 4500178401"
// and "what is 4500178401" both contain a document number and only one of them is a
// request to do something.
export function readIntent(question, context) {
  const expanded = expand(question, context);
  const result = parseIntent(expanded, context);
  return { ...result, memory: nextMemory(question, context, result, expanded) };
}

function parseIntent(question, context) {
  const q = String(question || '').trim();
  const lower = q.toLowerCase();
  const { documents, materials, vendors, plant, manager } = context;

  if (!q) return answer('Ask me what is waiting, what is short, or tell me to raise or approve something.');

  // --- Actions ---------------------------------------------------------------

  // Approve or send back, by document number.
  const decideVerb = /\b(approve|release|sign|reject|send back|send it back|turn down)\b/i.exec(lower);
  if (decideVerb) {
    const id = documentIn(q);
    if (!id) {
      const waiting = documents.filter((d) => canDecide(d));
      return answer(
        waiting.length === 0
          ? 'Nothing is waiting to be approved.'
          : `Which one? ${plural(waiting.length, 'document')} waiting:\n` +
            waiting.map((d) => `• ${d.kind} ${d.id}, ${d.supplierName}, ${inr(d.total)}`).join('\n'),
        { goTo: 'approvals' }
      );
    }

    const document = documents.find((d) => d.id === id);
    if (!document) return answer(`I cannot find ${id}.`);

    const rejecting = /\b(reject|send back|send it back|turn down)\b/i.test(lower);

    if (!canDecide(document)) {
      return answer(
        document.status === 'pending'
          ? `${id} has already been signed by you and is with ${document.next?.name || 'the next approver'}.`
          : `${id} was already ${document.status}.`,
        { openDocument: id }
      );
    }

    const actor = whoseTurn(document, manager);
    const finishes = rejecting || !document.next || Boolean(document.decidedAt);

    return proposal({
      summary: rejecting
        ? `Send ${document.kind} ${id} back`
        : actor.self
          ? `Approve ${document.kind} ${id}`
          : `Record ${actor.name} approving ${document.kind} ${id}`,
      detail: [
        `${document.material}, ${document.supplierName}`,
        `${document.plant} plant, ${inr(document.total)}`,
        actor.self ? `Signing as ${manager}` : `Recording the decision of ${actor.name}`,
        rejecting
          ? 'This finishes the document. It goes no further.'
          : finishes
            ? 'This is the last approval, so it RELEASES the order.'
            : `After you, it goes to ${document.next.name}.`
      ],
      warning:
        !rejecting && finishes && document.total >= 10000000
          ? `This releases ${inr(document.total)}. Check it before confirming.`
          : null,
      endpoint: rejecting ? `/api/approvals/${id}/reject` : `/api/approvals/${id}/approve`,
      body: { note: 'Approved from Ask' },
      confirmLabel: rejecting ? 'Send it back' : 'Approve'
    });
  }

  // Move a shipment along.
  if (/\b(dispatch(?:ed)?|despatch(?:ed)?|in transit|delivered|goods receipt|received|shipped|sent to vendor)\b/i.test(lower)) {
    const id = documentIn(q);
    const tracked = documents.filter(isTrackable);
    if (!id) {
      return answer(
        tracked.length === 0
          ? 'Nothing has been released yet, so nothing is on its way.'
          : `Which order? ${plural(tracked.length, 'order')} on the way:\n` +
            tracked.map((d) => `• ${d.id}, ${d.supplierName}, ${stageByKey(currentStage(d))?.label}`).join('\n'),
        { goTo: 'shipments' }
      );
    }
    const document = documents.find((d) => d.id === id);
    if (!document) return answer(`I cannot find ${id}.`);
    if (!isTrackable(document)) return answer(`${id} has not been released yet, so nothing is on its way.`);

    const next = nextStage(document);
    if (!next) return answer(`${id} has already been booked into stock.`);

    return proposal({
      summary: `Record ${id} as "${next.label}"`,
      detail: [`${document.material}, ${document.supplierName}`, next.describe, `Currently ${stageByKey(currentStage(document))?.label}.`],
      endpoint: `/api/shipments/${id}/advance`,
      body: { stage: next.key, note: 'Recorded from Ask' },
      confirmLabel: next.action
    });
  }

  // --- Questions -------------------------------------------------------------

  // "which vendor should I use for gypsum", "who should I buy clinker from"
  //
  // Asked before the plain vendor lookup below, because "tell me about Aditya" and "should
  // I use Aditya" both name a vendor and want different answers - one is a record, the
  // other is advice.
  if (/\b(which|who|recommend|suggest|best|should i (use|buy|order))\b/i.test(lower) && /\b(vendor|supplier|buy from|source)\b/i.test(lower)) {
    const material = materialIn(q, materials);
    if (!material) {
      return {
        ...answer(
          'Which material? Name it and I will tell you who has supplied it, how they have actually performed, and who else could.',
          { goTo: 'suppliers' }
        ),
        awaiting: 'material'
      };
    }

    const advice = recommendFor(material, vendors, documents);
    if (!advice || advice.ranked.length === 0) {
      return answer(
        `Nobody on file has supplied ${material.name}, and there is no vendor in that trade to compare against. ` +
          `The Vendors screen has everybody we do have a record for.`,
        { goTo: 'suppliers' }
      );
    }

    const lines = advice.ranked.slice(0, 4).map((r) => {
      const tags = [r.usual ? 'usual vendor' : null, r.used && !r.usual ? 'has supplied it before' : null, !r.used ? 'same trade, never used for this' : null]
        .filter(Boolean)
        .join(', ');
      return `• **${r.vendor.name}**${r.score === null ? '' : ` — ${r.score}/100`}${tags ? ` (${tags})` : ''}\n  ${r.verdict}`;
    });

    const head = advice.best
      ? advice.changes
        ? `For ${material.name} I would use **${advice.best.vendor.name}** rather than ${advice.usual.vendor.name}, on the record below.`
        : `For ${material.name}, **${advice.best.vendor.name}** is the best of what we have${advice.best.usual ? ', and is who you already use' : ''}.`
      : `Nobody who supplies ${material.name} has a completed order to judge them on yet.`;

    return answer(
      `${head}\n\n${lines.join('\n')}\n\n` +
        `Ranked on delivery first, then quality, then rate — a late load costs more than the rate on it. ` +
        `Say "order ${material.name} from ${(advice.best || advice.ranked[0]).vendor.name}" and I will set it up.`,
      { goTo: 'suppliers' }
    );
  }


  const plantAsked = plantIn(q);
  if (plantAsked && /\b(show|only|switch|filter)\b/i.test(lower)) {
    return answer(`Showing ${plantAsked} only. Every screen now follows that.`, { plant: plantAsked });
  }

  const id = documentIn(q);
  if (id) {
    const document = documents.find((d) => d.id === id);
    if (!document) return answer(`I cannot find ${id}.`);
    return answer(
      `**${document.kind} ${document.id}**\n${document.material}, ${document.supplierName}, ${document.plant}.\n` +
        `${inr(document.total)}, ${document.status}${document.decidedBy ? ` by ${document.decidedBy}` : ''}.\n` +
        (isTrackable(document) ? `Shipment: ${stageByKey(currentStage(document))?.label}.` : ''),
      { openDocument: id }
    );
  }

  // Stems, so "waiting" and "approval" match. No trailing \b - that is what broke it.
  if (/\b(wait|approv|need me|today|morning|to do)/i.test(lower)) {
    const waiting = documents.filter((d) => canDecide(d));
    if (waiting.length === 0) return answer('Nothing is waiting for you.', { goTo: 'approvals' });
    return answer(
      `**${plural(waiting.length, 'document')} waiting:**\n` +
        waiting
          .slice()
          .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
          .map((d) => `• ${d.kind} ${d.id}, ${d.supplierName}, ${inr(d.total)}, ${d.hoursWaiting} hours`)
          .join('\n') +
        '\n\nSay "approve" and a number and I will set it up for you to confirm.',
      { goTo: 'approvals' }
    );
  }

  if (/\b(ship|where|transit|on its way|track)/i.test(lower)) {
    const tracked = documents.filter(isTrackable);
    if (tracked.length === 0) return answer('Nothing has been released yet, so nothing is on its way.', { goTo: 'shipments' });
    return answer(
      `**${plural(tracked.length, 'released order')}:**\n` +
        tracked.map((d) => `• ${d.id}, ${d.supplierName}, ${stageByKey(currentStage(d))?.label}`).join('\n'),
      { goTo: 'shipments' }
    );
  }

  // "what will run out first", "what is short", "how much gypsum do we have"
  //
  // This existed in the browser version and was missed when Ask moved to the server, so
  // the chip asking it fell through to the help text - which reads as the assistant not
  // knowing rather than as something simply not wired up.
  //
  // Ordered by when each material runs out rather than by how short it is: a material
  // that is 10 tonnes short and needed on Friday is a worse problem than one that is 400
  // short and not wanted until next month.
  if (/\b(run out|runs out|short|stock|inventory|how much|running low)/i.test(lower)) {
    const named = materialIn(q, materials);

    if (named) {
      const cover = Number(named.daysOfCover);
      return answer(
        `**${named.name}** at ${named.plant}\n` +
          `${Number(named.onHand).toLocaleString('en-IN')} ${named.unit} in stock` +
          `${named.openOrderQuantity > 0 ? `, ${Number(named.openOrderQuantity).toLocaleString('en-IN')} on order` : ''}.\n` +
          `Departments have asked for ${Number(named.totalNeeded).toLocaleString('en-IN')} ${named.unit}` +
          `${named.shortBy > 0 ? `, which leaves it **${Number(named.shortBy).toLocaleString('en-IN')} ${named.unit} short**` : ', which it covers'}.\n` +
          `${Number.isFinite(cover) ? `About ${cover} days of cover.` : ''}` +
          `${named.neededFrom ? ` First needed ${named.neededFrom}.` : ''}` +
          `${named.kiln ? ' The kiln runs on it.' : ''}`,
        { goTo: 'stock' }
      );
    }

    const short = materials
      .filter((m) => Number(m.shortBy) > 0)
      .sort((a, b) => (Number(a.daysOfCover) || 0) - (Number(b.daysOfCover) || 0));

    if (short.length === 0) {
      return answer('Every material covers what the plants have asked for.', { goTo: 'stock' });
    }

    return answer(
      `**${plural(short.length, 'material')} short, soonest first:**\n` +
        short
          .map(
            (m) =>
              `• ${m.name} at ${m.plant} — ${Number(m.shortBy).toLocaleString('en-IN')} ${m.unit} short` +
              `${Number.isFinite(Number(m.daysOfCover)) ? `, ${m.daysOfCover} days of cover` : ''}` +
              `${m.neededFrom ? `, needed ${m.neededFrom}` : ''}` +
              `${m.kiln ? ' (kiln)' : ''}`
          )
          .join('\n') +
        `\n\nAsk me which vendor to use for any of them.`,
      { goTo: 'stock' }
    );
  }

  const vendor = vendorIn(q, vendors);
  if (vendor) {
    if (!vendor.scored) return answer(`${vendor.name} has no completed orders yet, so there is nothing to judge them on.`, { goTo: 'suppliers' });
    return answer(
      `**${vendor.name}**, ${vendor.total} out of 100, ${String(vendor.bandLabel).toLowerCase()}.\n` +
        `On time ${vendor.onTimePercent}%, ${vendor.averageDaysLate} days late on average.\n` +
        `Quality ${vendor.averageQuality}% accepted. Rate ${vendor.percentOverContract > 0 ? '+' : ''}${vendor.percentOverContract}% against contract.`,
      { goTo: 'suppliers' }
    );
  }

  // "take me to stock", "go to vendors", "open shipment tracking"
  //
  // Navigating is not the same as asking. Somebody who says "take me to stock risk" wants
  // to be there and to be left alone, not to be read a summary first.
  // Stems throughout, because people write "vendors" and "approvals" - a trailing \b after
  // "vendor" matches the singular only, which is the form nobody uses for a screen name.
  const SCREENS = [
    { keys: /\b(overview|home|dashboard|summary)/i, tab: 'overview', name: 'Overview' },
    { keys: /\b(approval|waiting|inbox)/i, tab: 'approvals', name: 'Waiting for approval' },
    { keys: /\b(shipment|tracking|delivery|on its way)/i, tab: 'shipments', name: 'Shipment tracking' },
    { keys: /\b(stock|material|inventory|short)/i, tab: 'stock', name: 'Stock risk' },
    { keys: /\b(contract|commitment|open order)/i, tab: 'open', name: 'Open orders and contracts' },
    { keys: /\b(vendor|supplier)/i, tab: 'suppliers', name: 'Vendors' },
    { keys: /\b(team|people|performance)/i, tab: 'team', name: 'Team performance' },
    { keys: /\b(problem|situation|stuck)/i, tab: 'situations', name: 'Problems found' },
    { keys: /\b(mail|email)/i, tab: 'email', name: 'Approval by email' }
  ];

  if (/\b(take me|go to|open|show me|switch to|navigate)/i.test(lower)) {
    const screen = SCREENS.find((sc) => sc.keys.test(lower));
    if (screen) return answer(`Opening ${screen.name}.`, { goTo: screen.tab });
    return answer(
      'Which screen? Overview, waiting for approval, raise a requisition, raise an order, shipment tracking, ' +
        'stock risk, open orders and contracts, vendors, team performance or problems found.'
    );
  }

  return answer(
    'I can tell you what is waiting, what is short, where an order has got to, or about any vendor.\n' +
      'I can advise: "which vendor should I use for gypsum".\n' +
      'I can take you places: "open shipment tracking".\n' +
      'And I can do things: "approve 4500178401", "send back 4500178401", "mark it dispatched".\n' +
      'You can keep talking - say "approve it" or "which vendor?" and I will know what you mean.\n' +
      'Anything that changes something is shown to you first and only happens when you confirm it.'
  );
}
