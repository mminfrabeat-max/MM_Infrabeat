// Who owes what, worked out from the documents rather than typed into a file.
//
// The screen this feeds used to describe teams by five numbers that somebody had written
// down - tasks with them, mails awaiting reply, usual reply time. None of it came from
// anywhere, none of it changed, and none of it told you what to do.
//
// So a task here is never entered. It is a thing the documents say is outstanding:
//
//   a requisition waiting for a signature          who is holding it
//   a requisition released with no order raised    the buying desk owes an order
//   an order on its way                            logistics is watching it
//   an order delivered                             stores has booked it in
//   a vendor whose record is slipping              the vendor desk owes a review
//
// Which means the board cannot go stale, cannot disagree with the rest of the dashboard,
// and cannot show a task that somebody forgot to close - because there is nothing to close.
// Approve the requisition and its row leaves the board by itself.
//
// Ownership has two rules, in this order:
//
//   1. If a document names the person it is waiting on, it is theirs. That is a fact.
//   2. Otherwise it belongs to whoever owns that kind of work. "Raise the order" is not
//      addressed to anybody in SAP, but the buying desk owes it.

import { plural } from './format.js';

// The core purchase tasks this dashboard can actually see. Two of the ten - quotations and
// invoice matching - are deliberately absent: there is no RFQ and no invoice anywhere in
// the data, and a category that is permanently empty teaches the reader to ignore the list.
export const KPIS = [
  { key: 'all', label: 'All work' },
  { key: 'needs', label: 'Needs identification' },
  { key: 'po', label: 'Purchase order creation' },
  { key: 'tracking', label: 'Order tracking & expediting' },
  { key: 'receipt', label: 'Goods receipt & inspection' },
  { key: 'vendor', label: 'Vendor management' },
  // Given out by hand, and not about any one document: ring a vendor, chase a quotation,
  // collect a form. It has no rule that could derive it, which is the whole reason a person
  // has to be able to type it in.
  { key: 'other', label: 'Given out by hand' }
];

// Who owns each kind of work when no document names a person.
//
// Four managers, because four is how many the work actually falls to. Adding the other
// three team leads would put three empty cards on the screen, and an empty card reads as a
// person with nothing to do rather than as a category with nothing in it.
const OWNERS = [
  { key: 'needs', team: 'Procurement desk' },
  { key: 'po', team: 'Procurement desk' },
  { key: 'tracking', team: 'Logistics and freight' },
  { key: 'receipt', team: 'Stores and receiving' },
  { key: 'vendor', team: 'Contracts and vendor master' }
];

const teamFor = (key) => OWNERS.find((o) => o.key === key)?.team || null;

function atPlant(row, plant) {
  return plant === 'all' || row.plant === plant;
}

// Hours, as something short enough to sit at the end of a row.
function ageOf(hours) {
  if (hours === null || hours === undefined) return null;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

// "8 Sep 2026, 11:42 am" to hours ago. Anything unreadable gives nothing rather than a
// number made up from a failed parse.
function hoursSince(text) {
  const when = Date.parse(String(text || '').replace(',', ''));
  if (Number.isNaN(when)) return null;
  return (Date.now() - when) / 36e5;
}

/**
 * Every outstanding piece of work, with the person it sits with.
 */
export function tasksFrom(data, plant = 'all', assigned = []) {
  const documents = (data.documents || []).filter((d) => atPlant(d, plant));
  const tasks = [];

  const raised = new Set(
    (data.documents || []).filter((d) => d.kind === 'PO' && d.sourceDocument).map((d) => d.sourceDocument)
  );

  // 1. Waiting for a signature. The document says whose turn it is, so it is theirs.
  for (const d of documents.filter((x) => x.status === 'pending')) {
    const state = d.approvalState || {};
    const kpi = d.kind === 'PR' ? 'needs' : 'po';
    tasks.push({
      id: `sign-${d.id}`,
      kpi,
      documentId: d.id,
      title: `${d.kind} ${d.id}`,
      what: d.material,
      status: state.label || 'Pending',
      tone: state.state === 'partial' ? 'pri' : 'warn',
      hours: Number(d.hoursWaiting) || 0,
      with: state.withYou ? 'you' : state.holder || teamFor(kpi),
      done: false
    });
  }

  // 2. Released and never turned into an order. Nobody is named on this one - approving a
  //    requisition is not the same as placing the order, and this is the gap between.
  for (const d of documents.filter((x) => x.kind === 'PR' && x.status === 'approved' && !raised.has(x.id))) {
    tasks.push({
      id: `raise-${d.id}`,
      kpi: 'po',
      documentId: d.id,
      title: `PR ${d.id}`,
      what: `${d.material} — raise the order`,
      status: 'Not started',
      tone: 'neg',
      hours: hoursSince(d.decidedAt),
      with: teamFor('po'),
      done: false
    });
  }

  // 3. On the road, and 4. arrived.
  for (const d of documents.filter((x) => x.shipmentStage)) {
    const delivered = d.shipmentStage === 'delivered';
    tasks.push({
      id: `ship-${d.id}`,
      kpi: delivered ? 'receipt' : 'tracking',
      documentId: d.id,
      title: `PO ${d.id}`,
      what: delivered ? `${d.material} — booked in` : `${d.material} — on its way`,
      status: delivered ? 'Done' : 'In transit',
      tone: delivered ? 'pos' : 'pri',
      hours: null,
      with: teamFor(delivered ? 'receipt' : 'tracking'),
      done: delivered
    });
  }

  // 5. A vendor whose record is going the wrong way, with work still open.
  for (const v of (data.suppliers || []).filter((s) => s.scored && s.trend === 'getting worse')) {
    const open = (data.documents || []).filter((d) => d.supplierId === v.supplierId && d.status === 'pending').length;
    tasks.push({
      id: `vendor-${v.supplierId}`,
      kpi: 'vendor',
      title: v.name,
      what: `${v.total}/100, ${v.averageDaysLate} days late on average${open ? `, ${plural(open, 'order')} open` : ''}`,
      status: 'Needs a review',
      tone: 'warn',
      hours: null,
      with: teamFor('vendor'),
      done: false
    });
  }

  // 6. And the ones somebody typed in and gave to a person.
  //
  // These are the only tasks here that can be finished by pressing something, because they
  // are the only ones with nowhere else to be finished. A requisition leaves this board when
  // it is approved on its own screen; "ring the vendor" leaves it when somebody says so.
  for (const task of assigned) {
    if (plant !== 'all' && task.plant && task.plant !== plant) continue;

    tasks.push({
      id: task.id,
      kpi: task.kpi || 'other',
      title: task.title,
      what: [task.detail, task.due ? `due ${task.due}` : null].filter(Boolean).join(' · '),
      status: statusLabel(task.status),
      tone: task.status === 'done' ? 'pos' : task.status === 'blocked' ? 'neg' : task.status === 'in progress' ? 'pri' : 'warn',
      hours: hoursSince(task.createdAt),
      with: task.assignedTo,
      teamId: task.teamId,
      member: task.assignedTo,
      assigned: true,
      rawStatus: task.status,
      done: task.status === 'done'
    });
  }

  return tasks;
}

function statusLabel(status) {
  return { open: 'To do', 'in progress': 'In progress', blocked: 'Blocked', done: 'Done' }[status] || 'To do';
}

/**
 * How much is open on the board, for the number beside the tab name.
 */
export function openTaskCount(data, plant = 'all', assigned = []) {
  return tasksFrom(data, plant, assigned).filter((t) => !t.done && t.with !== 'you').length;
}

// A comfortable number of open items for one manager to be carrying.
//
// A judgement, not a measurement, and it is the only number on this screen that is. It has
// to be something: bandwidth means how much room is left, and room is only meaningful
// against a full load. Drawing the bar against the busiest of the four instead - which is
// what it did first - answers a different question and a much less useful one, because four
// people with nothing to do still produce one full bar.
//
// Six because beyond that a person is deciding what NOT to look at today. Change it here.
export const COMFORTABLE = 6;

// How much room somebody has left.
function loadOf(open) {
  const free = Math.max(0, COMFORTABLE - open);
  const percent = Math.min(100, Math.round((open / COMFORTABLE) * 100));

  const band =
    open === 0
      ? { label: 'Free', tone: 'pos' }
      : open <= 2
        ? { label: 'Room to spare', tone: 'pos' }
        : open <= 5
          ? { label: 'Steady', tone: 'warn' }
          : open <= COMFORTABLE
            ? { label: 'Full', tone: 'neg' }
            : { label: 'Over capacity', tone: 'neg' };

  return { ...band, free, percent, capacity: COMFORTABLE };
}

/**
 * The managers, each with the work that sits with them.
 *
 * Your own items are left off on purpose. Nine of them are waiting on your signature, and
 * they already have two screens of their own - this one is about the people you would have
 * to ring.
 */
export function managersFrom(data, plant = 'all', kpi = 'all', assigned = []) {
  const everything = tasksFrom(data, plant, assigned);
  const tasks = kpi === 'all' ? everything : everything.filter((t) => t.kpi === kpi);
  const teams = data.teams || [];

  // A document names "Mr. Anil Deshmukh" in one place and "A. Deshmukh" in another. Same
  // person, two spellings, and nothing joins up until they are treated as one - so the
  // surname does the matching and the team file supplies the name to show.
  const surname = (name) =>
    String(name || '')
      .replace(/^(Mr|Ms|Mrs)\.?\s*/i, '')
      .split(/\s+/)
      .pop()
      .toLowerCase();

  const owning = [...new Set(OWNERS.map((o) => o.team))];

  const managers = owning
    .map((teamName) => {
      const team = teams.find((t) => t.name === teamName);
      if (!team) return null;

      const mine = tasks.filter((t) => {
        // Given out inside this team, whoever it was given to.
        if (t.assigned) return t.teamId === team.id;
        // Otherwise it is the manager's, either because the work belongs to their desk or
        // because a document names them.
        return t.with === teamName || (t.with && t.with !== 'you' && surname(t.with) === surname(team.lead));
      });

      const open = mine.filter((t) => !t.done);
      const done = mine.filter((t) => t.done);

      // What they have actually signed, from the documents. Not a count of anything typed.
      const signed = (data.documents || []).filter(
        (d) => d.decidedBy && surname(d.decidedBy) === surname(team.lead)
      ).length;

      const oldest = open.reduce((worst, t) => Math.max(worst, t.hours || 0), 0);

      // Three indicators, chosen so that they are fair across four teams doing different
      // work - which ruled out the obvious one.
      //
      // "Cleared", done against everything, looks like the natural measure and is not:
      // stores books deliveries in and finishes six things a week, the vendor desk reviews
      // suppliers and finishes almost nothing, and a percentage would read as one team
      // working and the other idling. What is comparable is whether work is ageing on
      // somebody, and that is the same question whatever the work is.
      const ageing = open.filter((t) => (t.hours || 0) >= 72).length;
      const given = mine.filter((t) => t.assigned);
      const givenDone = given.filter((t) => t.done).length;

      const kpis = [
        {
          key: 'ageing',
          label: 'Ageing',
          value: ageing,
          sub: ageing === 1 ? 'item over 3 days' : 'items over 3 days',
          tone: ageing === 0 ? 'pos' : ageing <= 2 ? 'warn' : 'neg'
        },
        {
          key: 'oldest',
          label: 'Oldest',
          value: ageOf(oldest || null) || '—',
          sub: oldest ? 'waiting' : 'nothing ageing',
          tone: !oldest ? 'pos' : oldest >= 168 ? 'neg' : oldest >= 72 ? 'warn' : 'pos'
        },
        {
          key: 'given',
          label: 'Given out',
          value: given.length ? `${givenDone}/${given.length}` : '—',
          sub: given.length ? 'finished' : 'none given yet',
          tone: !given.length ? 'mut' : givenDone === given.length ? 'pos' : 'pri'
        }
      ];

      // The people under this manager, each with what has been given to them.
      //
      // Only hand-assigned work is counted. A requisition waiting for the manager's own
      // signature is not on a buyer's desk, and putting it there would make somebody look
      // busy with something they cannot act on.
      const members = (team.members || []).map((person) => {
        const theirs = tasks.filter((t) => t.assigned && t.member === person.name);
        const theirOpen = theirs.filter((t) => !t.done);
        return {
          ...person,
          tasks: theirOpen,
          open: theirOpen.length,
          done: theirs.length - theirOpen.length,
          load: loadOf(theirOpen.length)
        };
      });

      return {
        id: team.id,
        name: team.lead,
        team: team.name,
        plant: team.plant,
        people: team.people,
        reminderReaches: team.reminderReaches,
        kpis,
        purchaseGroup: team.purchaseGroup,
        purchaseGroupName: team.purchaseGroupName,
        members,
        tasks: open.sort((a, b) => (b.hours || 0) - (a.hours || 0)),
        finished: done,
        open: open.length,
        done: done.length,
        signed,
        oldest: ageOf(oldest || null),
        load: loadOf(open.length)
      };
    })
    .filter(Boolean);

  // Busiest first, and only those with something.
  //
  // Narrow to one kind of work and three of the four have nothing to do with it - and an
  // empty card reads as a person with nothing on, which is a different and much worse
  // statement than a heading that does not concern them.
  return managers.filter((m) => m.open + m.done > 0).sort((a, b) => b.open - a.open);
}

// What the dropdown puts in brackets.
//
// Counting only what the board will show. Your own items are not on it, so counting them
// here would promise seven requisitions under a heading and then show three.
export function countsByKpi(data, plant = 'all', assigned = []) {
  const tasks = tasksFrom(data, plant, assigned).filter((t) => t.with !== 'you');
  const counts = { all: tasks.length };
  for (const t of tasks) counts[t.kpi] = (counts[t.kpi] || 0) + 1;
  return counts;
}
