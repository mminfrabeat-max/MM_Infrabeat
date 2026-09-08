// What each team is working on, what they owe you, and what you owe them.
//
// Everything on this screen is outside SAP. A purchasing system knows a requisition has
// been open eleven days; it does not know that the buyer is waiting on you for an answer.
// That gap is the whole reason the screen exists.

import { initials, plural, mailAddressFor } from '../format.js';
import { APPROVER_NAME, COMPANY, USER_PROFILE } from '../brand.js';
import { byPlant, teamsNeedingNudge } from '../selectors.js';
import { Card, Banner, Tile, Chip, Icon, SimulatedNote } from '../components/ui.jsx';
import { SparkArea, toneColour } from '../components/charts.jsx';

export default function Teams({ data, plant, onWriteMail, onCall, onAddTask }) {
  const teams = byPlant(data.teams, plant);
  const nudge = teamsNeedingNudge(data.teams, plant);
  const sum = (field) => teams.reduce((total, t) => total + t[field], 0);

  return (
    <>
      <Banner icon="people">
        What each team is working on, what they owe you, and what you owe them. Call or send
        a reminder straight from the row. Reply time is how long that team usually takes to
        answer your mail.
      </Banner>

      <SimulatedNote>
        None of this comes from SAP. A real version would read a task system, a mail server
        and a calendar.
      </SimulatedNote>

      <div className="tiles">
        <Tile
          icon="people"
          label="Teams"
          value={teams.length}
          sub={`${sum('people')} people`}
          tone="mut"
          footer={plant === 'all' ? 'across all three plants' : `at ${plant}`}
          spark={<SparkArea values={[7, 7, 7, 7, 7, 7, 7]} colour={toneColour('pri')} />}
        />
        <Tile
          icon="doc"
          label="Tasks with them"
          value={sum('tasks')}
          sub={`${sum('done')} completed`}
          tone="warn"
          footer="given by you this month"
          spark={<SparkArea values={[30, 33, 36, 38, 40, 41, 42]} colour={toneColour('warn')} />}
        />
        <Tile
          icon="mail"
          label="Mails awaiting reply"
          value={sum('mailsWaiting')}
          sub="from your teams"
          tone={sum('mailsWaiting') ? 'neg' : 'pos'}
          footer="oldest is five days"
          spark={<SparkArea values={[8, 10, 11, 13, 14, 15, 16]} colour={toneColour(sum('mailsWaiting') ? 'neg' : 'pos')} />}
        />
        <Tile
          icon="alert"
          label="Need a nudge"
          value={nudge.length}
          sub={nudge.length === 1 ? 'team' : 'teams'}
          tone={nudge.length ? 'warn' : 'pos'}
          footer="slow to reply or blocked"
          spark={<SparkArea values={[2, 2, 3, 3, 4, 4, 4]} colour={toneColour(nudge.length ? 'warn' : 'pos')} />}
        />
      </div>

      <div className="grid">
        <Card
          span="c12"
          icon="people"
          tone="pri"
          title="What each team is doing"
          subtitle="from their mails, their tasks and what they last told you"
          flush
        >
          {teams.length === 0 ? (
            <p className="muted rowpad">No teams at {plant}.</p>
          ) : (
            teams.map((t) => (
              <div className="team" key={t.id}>
                <span className={`tav${t.state === 'nudge' ? ' nudge' : ''}`}>{initials(t.lead)}</span>

                <div style={{ flex: 1, minWidth: 260 }}>
                  <div className="tname">
                    {t.name}
                    <Chip tone={t.state === 'nudge' ? 'warn' : 'pos'}>
                      {t.state === 'nudge' ? 'needs a nudge' : 'on track'}
                    </Chip>
                  </div>
                  <div className="tsub">{t.lead}, {plural(t.people, 'person', 'people')}, {t.plant}</div>
                  <div className="tline"><b>Doing now:</b> {t.now}</div>
                  <div className="tline fu"><b>Follow up:</b> {t.follow}</div>

                  <div className="tmets">
                    <div className="tmet"><div className="v n">{t.tasks}</div><div className="l">tasks with them</div></div>
                    <div className="tmet"><div className="v n">{t.done}</div><div className="l">completed</div></div>
                    <div className="tmet"><div className="v n">{t.mailsWaiting}</div><div className="l">mails awaiting reply</div></div>
                    <div className="tmet"><div className="v">{t.replyTime}</div><div className="l">usual reply time</div></div>
                    <div className="tmet"><div className="v">{t.lastSeen}</div><div className="l">last update</div></div>
                  </div>
                </div>

                <div className="tacts">
                  <button
                    className="btn emph"
                    type="button"
                    onClick={() =>
                      onWriteMail({
                        name: t.lead,
                        to: mailAddressFor(t.lead),
                        subject: `Follow up, ${t.name}`,
                        body:
                          `Hello ${t.lead},\n\n${t.follow}\n\n` +
                          `I can see your team is on: ${t.now}\n\n` +
                          `Could you send me where this stands today, or tell me what you need from my side to move it.\n\n` +
                          `Thanks,\n${APPROVER_NAME}\n${USER_PROFILE.role}, ${COMPANY}`
                      })
                    }
                  >
                    <Icon name="mail" size={13} /> Send reminder
                  </button>
                  <button className="btn q" type="button" onClick={() => onCall(t)}>
                    <Icon name="phone" size={13} /> Call {t.lead.split(' ')[1] || t.lead}
                  </button>
                  <button className="btn q" type="button" onClick={() => onAddTask(t)}>
                    <Icon name="doc" size={13} /> Add task
                  </button>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
