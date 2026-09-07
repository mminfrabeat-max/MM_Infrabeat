// The Ask panel's answers.
//
// This is pattern matching over the data already on screen, not a language model. That is
// a deliberate limit and worth being honest about: it can answer the handful of questions a
// head of procurement actually asks every morning, quickly and without sending anything
// anywhere. Anything outside those patterns says so plainly rather than guessing.
//
// Each answer returns { text, goTo, plant } so a question can also move the screen: asking
// about an order opens it, asking for one plant re-filters everything.

import { inr, plural } from './format.js';
import {
  byPlant, pendingDocuments, sumTotals, shortMaterials, contractsToWatch, sumValues
} from './selectors.js';

export const SUGGESTIONS = [
  'What is waiting for me?',
  'What will run out first?',
  'Which contracts should I look at?',
  'Can I trust Aditya?',
  'Show only Pune'
];

export function answer(question, data, plant) {
  const q = String(question).toLowerCase();

  // Switching plant, which changes every screen at once.
  const plantMatch = /pune|mumbai|nagpur|all plant/.exec(q);
  if (plantMatch) {
    const next = /mumbai/.test(q) ? 'Mumbai' : /pune/.test(q) ? 'Pune' : /nagpur/.test(q) ? 'Nagpur' : 'all';
    return {
      plant: next,
      text: `Showing ${next === 'all' ? 'all plants' : next} only. Everything on every screen now follows that.`
    };
  }

  // A document number, which opens it.
  const docMatch = /(45001\d{5}|10004\d{5}|4600\d{6})/.exec(q);
  if (docMatch) {
    const doc = data.documents.find((d) => d.id === docMatch[1]);
    if (doc) {
      return {
        openDocument: doc.id,
        text:
          `**${doc.kind} ${doc.id}**\n${doc.material}, ${doc.supplierName}, ${doc.plant} plant.\n` +
          `${doc.trade} order, ${doc.docType}, ${doc.incoterm}, by ${doc.transport.toLowerCase()}.\n` +
          `Total ${inr(doc.total)}, freight ${doc.freight ? inr(doc.freight) : doc.trade === 'Import' ? 'included in the CIF price' : 'not applicable'}, ` +
          `loading ${doc.loading ? inr(doc.loading) : 'nil'}.\n` +
          `Payment ${doc.payTerms}. ` +
          (doc.prev ? `Approved before by ${doc.prev.name} on ${doc.prev.when}.` : 'You are the first approver.')
      };
    }
    const contract = data.contracts.find((c) => c.id === docMatch[1]);
    if (contract) {
      return {
        goTo: 'open',
        text:
          `**Contract ${contract.id}**, ${contract.supplierName}, ${contract.covers}.\n` +
          `${inr(contract.target)} agreed, ${contract.percentUsed} percent used, ${inr(contract.remaining)} left.\n` +
          `Valid until ${contract.validTo}, ${contract.daysLeft} days from now. Status: ${contract.flag}.`
      };
    }
    return { text: `I cannot find ${docMatch[1]}.` };
  }

  if (/(run out|stock|short|material|need)/.test(q)) {
    const short = shortMaterials(data.materials, plant);
    if (short.length === 0) return { text: 'Every material covers what the plants have asked for.' };
    return {
      goTo: 'stock',
      text:
        `**${plural(short.length, 'material')} short:**\n` +
        short
          .map(
            (m) =>
              `• ${m.name} at ${m.plant}. ${m.needs.length} departments want ${m.totalNeeded.toLocaleString('en-IN')} ${m.unit}, ` +
              `we have ${m.available.toLocaleString('en-IN')}, first needed by ${m.neededFrom}`
          )
          .join('\n')
    };
  }

  if (/contract/.test(q)) {
    const flagged = contractsToWatch(data.contracts, plant);
    if (flagged.length === 0) return { text: 'Every contract is being used normally.' };
    return {
      goTo: 'open',
      text:
        `**${plural(flagged.length, 'contract')} to look at:**\n` +
        flagged
          .map(
            (c) =>
              `• ${c.id}, ${c.supplierName}, ${inr(c.target)} agreed, ${c.percentUsed} percent used, ${c.daysLeft} days left. ` +
              (c.flag === 'never used'
                ? 'Never used at all.'
                : c.flag === 'expiring soon'
                ? `Expiring soon with ${inr(c.remaining)} unused.`
                : 'Nearly used up.')
          )
          .join('\n')
    };
  }

  if (/(open|received|ordered|not yet)/.test(q)) {
    const orders = byPlant(data.openOrders, plant);
    const requests = byPlant(data.openRequests, plant);
    return {
      goTo: 'open',
      text:
        `Ordered but not received: ${orders.length} orders worth ${inr(sumValues(orders))}.\n` +
        `Asked for but not ordered: ${requests.length} requests worth ${inr(sumValues(requests))}.`
    };
  }

  if (/(team|who is working|nudge)/.test(q)) {
    const teams = byPlant(data.teams, plant);
    const nudge = teams.filter((t) => t.state === 'nudge');
    return {
      goTo: 'team',
      text:
        `${plural(teams.length, 'team')}${plant === 'all' ? '' : ` at ${plant}`}, ${nudge.length} needing a nudge.\n` +
        nudge.map((t) => `• ${t.name}, ${t.lead}. ${t.follow}`).join('\n')
    };
  }

  // A vendor by first word of the name.
  const vendor = data.suppliers.find((s) => q.includes(s.name.toLowerCase().split(' ')[0]));
  if (vendor) {
    if (!vendor.scored) return { goTo: 'suppliers', text: `${vendor.name} has no completed orders yet, so there is nothing to judge them on.` };
    return {
      goTo: 'suppliers',
      text:
        `**${vendor.name}**, ${vendor.total} out of 100, ${vendor.bandLabel.toLowerCase()}.\n` +
        `On time ${vendor.onTimePercent} percent, ${vendor.averageDaysLate} days late on average, trend ${vendor.trend}.\n` +
        `Quality ${vendor.averageQuality} percent accepted.\n` +
        `Rate ${vendor.percentOverContract > 0 ? '+' : ''}${vendor.percentOverContract} percent against contract.\n` +
        `GST ${vendor.gst}.`
    };
  }

  if (/(problem|stuck|situation|wrong)/.test(q)) {
    const open = byPlant(data.situations, plant).filter((s) => s.status === 'open');
    if (open.length === 0) return { text: 'No open problems. Everything checked this morning is clear.' };
    return {
      goTo: 'situations',
      text:
        `**${plural(open.length, 'problem')} open:**\n` +
        open.map((s) => `• ${s.title} (${s.relatedTo}), ${s.canAutoFix ? 'I can fix this' : 'needs your call'}`).join('\n')
    };
  }

  if (/(wait|approv|need me|today|morning)/.test(q)) {
    const pending = pendingDocuments(data.documents, plant);
    if (pending.length === 0) return { text: 'Nothing is waiting for you.' };
    return {
      goTo: 'approvals',
      text:
        `**${plural(pending.length, 'order')} waiting, ${inr(sumTotals(pending))} in total:**\n` +
        pending
          .slice()
          .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
          .map((d) => `• ${d.kind} ${d.id}, ${d.supplierName}, ${inr(d.total)}, ${d.hoursWaiting} hours`)
          .join('\n')
    };
  }

  return {
    text:
      'Ask me what is waiting for you, what will run out, which contracts to look at, about any vendor or team, ' +
      'or say show only Pune.'
  };
}
