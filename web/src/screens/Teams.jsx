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

export default function Teams({ data, plant, onWriteMail, onTeams, onOpenDocument }) {
  const [kpi, setKpi] = useState('all');
  const [expanded, setExpanded] = useState(null);

  const counts = countsByKpi(data, plant);
  const managers = managersFrom(data, plant, kpi);
  const chosen = KPIS.find((k) => k.key === kpi) || KPIS[0];

  const open = managers.reduce((total, m) => total + m.open, 0);
  const done = managers.reduce((total, m) => total + m.done, 0);

  return (
    <>
      <Banner icon="people">
        Every row here comes from a document, not from a task list somebody keeps. A
        requisition waiting for a signature, one released with no order raised, a load on the
        road, a vendor whose record is slipping &mdash; each sits with whoever owes the next
        move. Approve it or raise it and the row leaves by itself.
      </Banner>

      <SimulatedNote>
        Team names, plants and head counts are demonstration data. The work on each card is
        real, and comes from the same documents the other screens show.
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
              />
            ))
          )}
        </Card>
      </div>
    </>
  );
}

// Four tasks, then a line saying how many more.
//
// Four because that is what fits beside a person without the card becoming a list with a
// photograph on top - and because the fifth most urgent thing on somebody's desk is not
// what you ring them about.
const SHOWN = 4;

function Manager({ manager, expanded, onToggle, onOpenDocument, onWriteMail, onTeams }) {
  const shown = expanded ? manager.tasks : manager.tasks.slice(0, SHOWN);
  const more = manager.tasks.length - shown.length;

  return (
    <div className="mgr">
      <div className="mgrhd">
        <span className={`tav${manager.load.tone === 'neg' ? ' nudge' : ''}`}>{initialsOf(manager.name)}</span>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="tname">{manager.name}</div>
          <div className="tsub">
            {manager.team}, {manager.plant}
            {manager.people ? `, ${plural(manager.people, 'person', 'people')}` : ''}
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
        </div>
      </div>

      {manager.tasks.length === 0 ? (
        <p className="muted mgrempty">Nothing open with {firstOf(manager.name)} right now.</p>
      ) : (
        <div className="mgrtasks">
          {shown.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`mgrtask${task.documentId ? ' opens' : ''}`}
              onClick={() => task.documentId && onOpenDocument(task.documentId)}
              disabled={!task.documentId}
            >
              <span className="t1">{task.title}</span>
              <span className="t2">{task.what}</span>
              <span className="rt">
                <Chip tone={task.tone}>{task.status}</Chip>
                {task.hours ? <span className="t3">{ageOf(task.hours)}</span> : null}
              </span>
            </button>
          ))}

          {(more > 0 || expanded) && (
            <button type="button" className="mgrmore" onClick={onToggle}>
              {expanded ? 'Show fewer' : `${more} more with ${firstOf(manager.name)}`}
            </button>
          )}
        </div>
      )}
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
