// Who owes what, how loaded they are, and how to reach them.
//
// This screen used to describe seven teams by five numbers each - tasks with them, mails
// awaiting reply, usual reply time - all of them typed into a file by hand, none of them
// ever changing. Thirty-five figures that looked exactly like the real ones elsewhere in
// the dashboard.
//
// It is now four managers and the work the documents say is outstanding. Nothing on it is
// entered by anybody: a row appears because a requisition is waiting, or was released and
// never ordered, or a vendor is slipping - and it leaves when that stops being true. The
// KPI selector narrows it to one kind of work, which is the question actually asked out
// loud: not "how is Deshmukh doing" but "who has the orders that are not being raised".
//
// Your own items are not here. Nine of them are waiting on your signature and they have two
// screens of their own; this one is about people you would have to ring.

import { useState } from 'react';
import { plural } from '../format.js';
import { APPROVER_NAME, COMPANY, USER_PROFILE } from '../brand.js';
import { KPIS, managersFrom, countsByKpi } from '../teamwork.js';
import { Card, Banner, Chip, Icon, SimulatedNote } from '../components/ui.jsx';
import { Modal } from '../components/shell-bits.jsx';
import Gauge from '../components/gauge.jsx';

export default function Teams({
  data,
  plant,
  onWriteMail,
  onTeams,
  onOpenDocument,
  assigned = [],
  onAssign,
  onSetStatus,
  onDropTask,
  busy
}) {
  const [kpi, setKpi] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const [giving, setGiving] = useState(null);
  const [opened, setOpened] = useState(null);

  const counts = countsByKpi(data, plant, assigned);
  const managers = managersFrom(data, plant, kpi, assigned);
  const chosen = KPIS.find((k) => k.key === kpi) || KPIS[0];

  const open = managers.reduce((total, m) => total + m.open, 0);
  const done = managers.reduce((total, m) => total + m.done, 0);

  return (
    <>
      <Banner icon="people">
        Two kinds of work, on one board. Most of it is read off the documents &mdash; a
        requisition waiting for a signature, one released with no order raised, a load on the
        road, a vendor whose record is slipping &mdash; and each leaves by itself once it is
        approved or raised. The rest is what you hand out here: anything with no document
        behind it, given to a named person and finished when they say so.
      </Banner>

      <SimulatedNote>
        Team names, the people in them and the purchase group codes are demonstration data.
        The work read off documents is real, and tasks you give out are saved for real.
      </SimulatedNote>

      <div className="grid">
        <Card
          span="c12"
          icon="people"
          tone="pri"
          title="Who owes what"
          subtitle={`${plural(open, 'task')} open, ${done} finished, across ${plural(
            managers.length,
            'manager'
          )}`}
          beside={
            <select
              className="sel"
              value={kpi}
              onChange={(e) => setKpi(e.target.value)}
              aria-label="Show one kind of work"
            >
              {KPIS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                  {counts[k.key] ? ` (${counts[k.key]})` : ''}
                </option>
              ))}
            </select>
          }
          action={
            <button className="btn sm emph" type="button" onClick={() => setGiving({ team: managers[0] })}>
              <Icon name="doc" size={12} />
              Give out a task
            </button>
          }
          flush
        >
          {managers.length === 0 || open + done === 0 ? (
            <p className="muted rowpad">
              Nothing outstanding under {chosen.label.toLowerCase()}
              {plant === 'all' ? '' : ` at ${plant}`}.
            </p>
          ) : (
            managers.map((m) => (
              <Manager
                key={m.id}
                manager={m}
                expanded={expanded === m.id}
                onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                onOpenDocument={onOpenDocument}
                onWriteMail={onWriteMail}
                onTeams={onTeams}
                onGive={() => setGiving({ team: m })}
                onOpen={() => setOpened(m.id)}
                onSetStatus={onSetStatus}
                onDropTask={onDropTask}
                busy={busy}
              />
            ))
          )}
        </Card>
      </div>

      {opened && (
        <ManagerDetail
          manager={managers.find((m) => m.id === opened) || managersFrom(data, plant, 'all', assigned).find((m) => m.id === opened)}
          busy={busy}
          onClose={() => setOpened(null)}
          onOpenDocument={onOpenDocument}
          onSetStatus={onSetStatus}
          onDropTask={onDropTask}
          onWriteMail={onWriteMail}
          onGive={() => {
            const m = managers.find((x) => x.id === opened);
            setOpened(null);
            setGiving({ team: m });
          }}
        />
      )}

      {giving && (
        <GiveTask
          managers={managersFrom(data, plant, 'all', assigned)}
          start={giving.team}
          member={giving.member}
          plant={plant}
          busy={busy}
          onClose={() => setGiving(null)}
          onSave={async (task) => {
            await onAssign(task);
            setGiving(null);
          }}
        />
      )}
    </>
  );
}

// Everything about one manager, including what the indicators are made of.
//
// The card outside shows four items and three numbers. This is where the rest goes: every
// open item, everything finished, every person under them with what they are carrying - and
// underneath each indicator, the sentence saying what was counted to get it.
//
// That last part is the reason this exists. A number with a threshold on it invites exactly
// one question, which is "counted how?", and a dashboard that cannot answer it teaches
// people to distrust the numbers that ARE right.
function ManagerDetail({ manager, busy, onClose, onOpenDocument, onSetStatus, onDropTask, onWriteMail, onGive }) {
  if (!manager) return null;

  const given = [...manager.tasks, ...manager.finished].filter((t) => t.assigned);
  const derived = manager.tasks.filter((t) => !t.assigned);
  const givenDone = given.filter((t) => t.done);

  const HOW = {
    ageing: 'Anything on this card still open after three days, whether it came off a document or was given out by hand. Nothing finished counts.',
    oldest: 'The longest any single open item has waited - measured from when the document arrived at this desk, or from when the task was given out.',
    given: 'Only the tasks somebody typed in and handed to this team. Work read off documents is not counted here, because it is finished on its own screen rather than on this one.'
  };

  return (
    <Modal
      icon="people"
      title={manager.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn emph" type="button" onClick={() => onWriteMail(reminderFor(manager))}>
            <Icon name="mail" size={13} /> Send reminder
          </button>
          <button className="btn q" type="button" onClick={onGive}>
            <Icon name="doc" size={13} /> Give a task
          </button>
          <button className="btn q" type="button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <p className="dsub">
        {manager.team} &middot; {manager.plant}
        {manager.purchaseGroup ? ` · purchase group ${manager.purchaseGroup}` : ''}
        {manager.purchaseGroupName ? ` (${manager.purchaseGroupName})` : ''}
      </p>

      <div className="bandw" style={{ maxWidth: 'none' }}>
        <div className="bandtop">
          <span className="bandk">Bandwidth</span>
          <span className={`bandv ${manager.load.tone}`}>{manager.load.label}</span>
          <span className="bandf">
            {manager.open} of {manager.load.capacity}
            {manager.load.free > 0 ? ` · room for ${manager.load.free} more` : ' · nothing more today'}
          </span>
        </div>
        <div className="bandbar">
          <span className={`fill ${manager.load.tone}`} style={{ width: `${manager.load.percent}%` }} />
        </div>
      </div>

      <h4 className="dh">How they are doing</h4>
      <div className="dperf">
        <Gauge
          score={manager.performance.score}
          tone={manager.performance.tone}
          label={manager.performance.label}
          size={150}
        />
        <div className="dperfw">
          {manager.performance.reasons.length === 0 ? (
            <p className="dkpih">
              {manager.performance.measurable
                ? 'Nothing has come off. Every item is moving and anything handed out has come back.'
                : 'Nothing has come off - but none of the items on this desk carries a date, so there is nothing here that could age. Read this as no evidence against them rather than as a clean sheet.'}
            </p>
          ) : (
            <>
              <p className="dkpih">Starts at 100. What came off, and why:</p>
              <ul className="dwhy">
                {manager.performance.reasons.map((r) => (
                  <li key={r.what}>
                    <b>&minus;{r.points}</b> {r.what}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="dkpih">
            It does not count how much work they have. A manager holding nine things scores the
            same as one holding two, as long as neither is going stale &mdash; how much is on
            somebody is what the bandwidth bar above says.
          </p>
        </div>
      </div>

      {/* Each indicator, and under it what was counted. */}
      <h4 className="dh">What goes into it</h4>
      <div className="dkpis">
        {manager.kpis.map((k) => (
          <div className="dkpi" key={k.key}>
            <div className="dkpitop">
              <span className="kpil">{k.label}</span>
              <span className={`kpiv ${k.tone}`}>{k.value}</span>
              <span className="kpis2">{k.sub}</span>
            </div>
            <p className="dkpih">{HOW[k.key]}</p>
          </div>
        ))}
        {manager.signed > 0 && (
          <div className="dkpi">
            <div className="dkpitop">
              <span className="kpil">Signed</span>
              <span className="kpiv pri">{manager.signed}</span>
              <span className="kpis2">decisions</span>
            </div>
            <p className="dkpih">
              Requisitions and orders this person has actually approved, counted from the documents
              themselves rather than from anything entered here.
            </p>
          </div>
        )}
      </div>

      <h4 className="dh">
        Given to this team &mdash; {givenDone.length} of {given.length} finished
      </h4>
      {given.length === 0 ? (
        <p className="muted dnone">Nothing has been handed to them by hand yet.</p>
      ) : (
        <div className="dlist">
          {given.map((task) => (
            <div className={`mgrtask given${task.done ? ' isdone' : ''}`} key={task.id}>
              <span className="mgrwhat">
                <span className="t1">{task.title}</span>
                <span className="t2">
                  {task.what}
                  {task.member ? <span className="tgiven">with {task.member}</span> : null}
                </span>
              </span>
              <span className="rt">
                <Chip tone={task.tone}>{task.status}</Chip>
                <select
                  className="sel tiny"
                  value={task.rawStatus}
                  disabled={busy === 'task'}
                  onChange={(e) => onSetStatus(task.id, e.target.value)}
                  aria-label={`Status of ${task.title}`}
                >
                  <option value="open">To do</option>
                  <option value="in progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="done">Done</option>
                </select>
                <button
                  type="button"
                  className="attx"
                  aria-label={`Remove ${task.title}`}
                  disabled={busy === 'task'}
                  onClick={() => onDropTask(task.id)}
                >
                  &times;
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <h4 className="dh">Off the documents &mdash; {plural(derived.length, 'item')}</h4>
      {derived.length === 0 ? (
        <p className="muted dnone">Nothing from the documents sits with them right now.</p>
      ) : (
        <div className="dlist">
          {derived.map((task) => (
            <button
              type="button"
              className={`mgrtask${task.documentId ? ' opens' : ''}`}
              key={task.id}
              disabled={!task.documentId}
              onClick={() => {
                if (!task.documentId) return;
                onClose();
                onOpenDocument(task.documentId);
              }}
            >
              <span className="mgrwhat">
                <span className="t1">{task.title}</span>
                <span className="t2">{task.what}</span>
              </span>
              <span className="rt">
                <Chip tone={task.tone}>{task.status}</Chip>
                {task.hours ? <span className="t3">{ageOf(task.hours)}</span> : null}
              </span>
            </button>
          ))}
        </div>
      )}

      {(manager.members || []).length > 0 && (
        <>
          <h4 className="dh">The people under them</h4>
          <div className="dlist">
            {manager.members.map((person) => (
              <div className="dperson" key={person.id || person.name}>
                <div>
                  <div className="t1">{person.name}</div>
                  <div className="t2">{person.role}</div>
                </div>
                <div className="dpt">
                  {person.open === 0 ? (
                    <span className="muted">nothing on</span>
                  ) : (
                    person.tasks.map((t) => (
                      <div className="dptask" key={t.id}>
                        {t.title} <Chip tone={t.tone}>{t.status}</Chip>
                      </div>
                    ))
                  )}
                  {person.done > 0 && <div className="t3">{person.done} finished</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// Giving a piece of work to somebody.
//
// Four things and no more: who it is for, what it is, any detail, and when it is wanted.
// Everything else a task could carry - a priority, an estimate, a category chosen from
// twelve - is a field somebody has to fill in every time and nobody reads afterwards.
//
// The person comes first because it is the decision. The rest is describing what you have
// already decided to give them.
function GiveTask({ managers, start, member, plant, busy, onClose, onSave }) {
  const [teamId, setTeamId] = useState(start?.id || managers[0]?.id || '');
  const [assignedTo, setAssignedTo] = useState(member || '');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [due, setDue] = useState('');
  const [kpi, setKpi] = useState('other');

  const team = managers.find((m) => m.id === teamId) || managers[0];
  const people = team ? [{ name: team.name, role: 'Manager' }, ...(team.members || [])] : [];

  // Changing team changes who is on the list, so a name from the old team cannot be left
  // selected - it would be sent as the assignee and belong to nobody.
  function chooseTeam(id) {
    setTeamId(id);
    setAssignedTo('');
  }

  const ready = title.trim() && assignedTo;

  return (
    <Modal
      icon="doc"
      title="Give out a task"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn emph"
            type="button"
            disabled={!ready || busy === 'task'}
            onClick={() =>
              onSave({
                title: title.trim(),
                detail: detail.trim(),
                assignedTo,
                teamId,
                kpi,
                plant: plant === 'all' ? '' : plant,
                due: due.trim()
              })
            }
          >
            <Icon name="check" size={13} />
            {busy === 'task' ? 'Saving…' : 'Give it out'}
          </button>
          <button className="btn q" type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="mrow">
        <div className="mlab">Team</div>
        <select className="minp" value={teamId} onChange={(e) => chooseTeam(e.target.value)}>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.team}
              {m.purchaseGroup ? ` — ${m.purchaseGroup}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="mrow">
        <div className="mlab">To</div>
        <select className="minp" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">Choose somebody</option>
          {people.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} — {p.role}
            </option>
          ))}
        </select>
      </div>

      <div className="mrow">
        <div className="mlab">Task</div>
        <input
          className="minp"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ring Bharat Bearings about the mill bearing delivery"
        />
      </div>

      <div className="mrow">
        <div className="mlab">Detail</div>
        <textarea
          className="mtxt"
          style={{ minHeight: 92 }}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Anything they need to know to start. Optional."
        />
      </div>

      <div className="mrow">
        <div className="mlab">Kind</div>
        <select className="minp" value={kpi} onChange={(e) => setKpi(e.target.value)}>
          {KPIS.filter((k) => k.key !== 'all').map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mrow" style={{ marginBottom: 0 }}>
        <div className="mlab">Wanted by</div>
        <input
          className="minp"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          placeholder="Friday, or 22 Sep. Optional."
        />
      </div>
    </Modal>
  );
}

// Four tasks, then a line saying how many more.
//
// Four because that is what fits beside a person without the card becoming a list with a
// photograph on top - and because the fifth most urgent thing on somebody's desk is not
// what you ring them about.
const SHOWN = 4;

function Manager({ manager, expanded, onToggle, onOpenDocument, onWriteMail, onTeams, onGive, onOpen, onSetStatus, onDropTask, busy }) {
  const shown = expanded ? manager.tasks : manager.tasks.slice(0, SHOWN);
  const more = manager.tasks.length - shown.length;

  return (
    <div className="mgr">
      <div className="mgrhd">
        <span className={`tav${manager.load.tone === 'neg' ? ' nudge' : ''}`}>{initialsOf(manager.name)}</span>

        <div style={{ flex: 1, minWidth: 220 }}>
          {/* The name is the way in. Everything else on the card is a shortcut to one
              thing; this opens the whole picture, including what the indicators count. */}
          <button className="tname asname" type="button" onClick={onOpen}>
            {manager.name}
            <Icon name="chevron" size={14} />
          </button>
          <div className="tsub">
            {manager.team}, {manager.plant}
            {manager.people ? `, ${plural(manager.people, 'person', 'people')}` : ''}
            {manager.purchaseGroup && (
              <span className="pgrp" title={manager.purchaseGroupName || 'Purchase group'}>
                {manager.purchaseGroup}
              </span>
            )}
            {!manager.reminderReaches && (
              <span className="tmail none" title="Add them to MAIL_DIRECTORY in .env to have reminders delivered.">
                <Icon name="alert" size={11} /> no mailbox on file
              </span>
            )}
          </div>

          {/* How much room is left, against a full load rather than against each other.
              Drawn and said, because the number a manager acts on is not how busy somebody
              is but whether anything more can go to them today. */}
          <div className="bandw">
            <div className="bandtop">
              <span className="bandk">Bandwidth</span>
              <span className={`bandv ${manager.load.tone}`}>{manager.load.label}</span>
              <span className="bandf">
                {manager.open} of {manager.load.capacity}
                {manager.load.free > 0 ? ` · room for ${manager.load.free} more` : ' · nothing more today'}
              </span>
            </div>
            <div className="bandbar">
              <span className={`fill ${manager.load.tone}`} style={{ width: `${manager.load.percent}%` }} />
            </div>
            {/* The indicators, beside the load rather than under the tasks. Load says how
                much is on somebody; these say whether it is moving. */}
            <div className="kpis">
              {manager.kpis.map((k) => (
                <div className="kpi" key={k.key}>
                  <div className="kpil">{k.label}</div>
                  <div className={`kpiv ${k.tone}`}>{k.value}</div>
                  <div className="kpis2">{k.sub}</div>
                </div>
              ))}
            </div>

            {(manager.done > 0 || manager.signed > 0 || manager.oldest) && (
              <div className="bandl">
                {[
                  manager.done > 0 ? `${manager.done} finished` : null,
                  manager.signed > 0 ? plural(manager.signed, 'decision') + ' signed' : null,
                  manager.oldest ? `oldest ${manager.oldest}` : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
          </div>
        </div>

        <Gauge
          score={manager.performance.score}
          tone={manager.performance.tone}
          label={manager.performance.measurable ? manager.performance.label : 'nothing to age'}
          size={104}
        />

        <div className="tacts">
          <button
            className="btn emph"
            type="button"
            onClick={() => onWriteMail(reminderFor(manager))}
          >
            <Icon name="mail" size={13} /> Send reminder
          </button>
          <button className="btn q" type="button" disabled={!manager.reminderReaches} onClick={() => onTeams(manager, 'chat')}>
            <Icon name="send" size={13} /> Teams message
          </button>
          <button className="btn q" type="button" disabled={!manager.reminderReaches} onClick={() => onTeams(manager, 'call')}>
            <Icon name="phone" size={13} /> Teams call
          </button>
          <button className="btn q" type="button" onClick={onGive}>
            <Icon name="doc" size={13} /> Give a task
          </button>
        </div>
      </div>

      {manager.tasks.length === 0 ? (
        <p className="muted mgrempty">Nothing open with {firstOf(manager.name)} right now.</p>
      ) : (
        <div className="mgrtasks">
          {shown.map((task) => (
            <div className={`mgrtask${task.assigned ? ' given' : ''}`} key={task.id}>
              <button
                type="button"
                className={`mgrwhat${task.documentId ? ' opens' : ''}`}
                onClick={() => task.documentId && onOpenDocument(task.documentId)}
                disabled={!task.documentId}
              >
                <span className="t1">{task.title}</span>
                <span className="t2">
                  {task.what}
                  {task.assigned && task.member ? <span className="tgiven">with {task.member}</span> : null}
                </span>
              </button>

              <span className="rt">
                <Chip tone={task.tone}>{task.status}</Chip>
                {task.hours ? <span className="t3">{ageOf(task.hours)}</span> : null}

                {/* Only work given out by hand can be finished here, because it is the only
                    work with nowhere else to be finished. A requisition leaves this board
                    when it is approved on its own screen. */}
                {task.assigned && (
                  <>
                    <select
                      className="sel tiny"
                      value={task.rawStatus}
                      disabled={busy === 'task'}
                      onChange={(e) => onSetStatus(task.id, e.target.value)}
                      aria-label={`Status of ${task.title}`}
                    >
                      <option value="open">To do</option>
                      <option value="in progress">In progress</option>
                      <option value="blocked">Blocked</option>
                      <option value="done">Done</option>
                    </select>
                    <button
                      type="button"
                      className="attx"
                      title="Take this task off the board"
                      aria-label={`Remove ${task.title}`}
                      disabled={busy === 'task'}
                      onClick={() => onDropTask(task.id)}
                    >
                      &times;
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}

          {(more > 0 || expanded) && (
            <button type="button" className="mgrmore" onClick={onToggle}>
              {expanded ? 'Show fewer' : `${more} more with ${firstOf(manager.name)}`}
            </button>
          )}
        </div>
      )}

      <Members manager={manager} />
    </div>
  );
}

// The people under a manager, and what each is carrying.
//
// Only work that was given to them by name. A requisition waiting for the manager's own
// signature is not on a buyer's desk, and counting it here would show somebody as busy with
// something they have no way to act on.
function Members({ manager }) {
  const members = manager.members || [];
  if (members.length === 0) return null;

  return (
    <div className="mbrs">
      <div className="mbrh">
        {plural(members.length, 'person', 'people')} under {firstOf(manager.name)}
      </div>
      <div className="mbrrow">
        {members.map((person) => (
          <div className="mbr" key={person.id || person.name}>
            <div className="mbrn">{person.name}</div>
            <div className="mbrr">{person.role}</div>
            <div className="mbrbar">
              <span
                className={`fill ${person.load.tone}`}
                style={{ width: `${Math.max(person.open ? 8 : 0, person.load.percent)}%` }}
              />
            </div>
            <div className="mbrl">
              {person.open === 0 ? 'nothing on' : plural(person.open, 'task')}
              {person.done > 0 ? ` · ${person.done} done` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ageOf(hours) {
  return hours < 48 ? `${Math.round(hours)} h waiting` : `${Math.round(hours / 24)} days waiting`;
}

function initialsOf(name) {
  const parts = String(name).replace(/^(Mr|Ms|Mrs)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] || '')[0] || '').toUpperCase();
}

function firstOf(name) {
  return String(name).replace(/^(Mr|Ms|Mrs)\.?\s+/i, '').split(' ')[0];
}

// The reminder names what is actually outstanding, rather than asking in general how things
// are going. A list of four document numbers is answerable; "any update?" is not.
function reminderFor(manager) {
  const lines = manager.tasks
    .slice(0, 6)
    .map((t) => `  ${t.title} — ${t.what} (${t.status}${t.hours ? `, ${ageOf(t.hours)}` : ''})`)
    .join('\n');

  return {
    name: manager.name,
    toName: manager.name,
    subject: `Following up: ${plural(manager.open, 'item')} with you`,
    body:
      `Hello ${manager.name},\n\n` +
      `These are open with you at the moment:\n\n${lines}\n\n` +
      `Could you tell me where each stands, or what you need from my side to move them.\n\n` +
      `Thanks,\n${APPROVER_NAME}\n${USER_PROFILE.role}, ${COMPANY}`
  };
}
