// The conversation: a Gemini chat session, the tool loop around it, and the pause where a
// person confirms anything that would change something.
//
// The shape, in one paragraph. A question goes to the model along with what the dashboard
// is currently showing. The model either answers, or asks for one or more tools. Read tools
// run immediately and their results go straight back in, up to five rounds - five because a
// model that has not finished looking things up after five rounds is lost, and the honest
// thing is to stop rather than spend somebody's money in a circle. An action tool does NOT
// run. The loop stops, the browser is handed a sentence describing what was asked for, and
// nothing else happens until a person presses a button.
//
// The session lives here rather than in the browser because chats.create() holds the
// history, and because a conversation that the browser could edit is a conversation anybody
// could put words into.

import { GoogleGenAI } from '@google/genai';

import { SYSTEM_PROMPT } from './system-prompt.js';
import { READ_TOOLS, ACTION_TOOLS, READ_HANDLERS, isAction, describeAction, dmy } from './tools.js';
import { ACTION_HANDLERS } from './actions.js';
import { readIntent } from '../domain/ask.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MAX_ROUNDS = 5;

// Conversations are dropped after this long unused, and the oldest goes when there are too
// many. Both are here so a demo left open overnight cannot quietly hold the process's
// memory, and neither number is interesting enough to put in the environment.
const IDLE_MINUTES = 90;
const MAX_SESSIONS = 50;

export function assistantConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

let client = null;

function genai() {
  if (!client) {
    if (!assistantConfigured()) throw new Error('GEMINI_API_KEY is not set.');
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// --- Logging -------------------------------------------------------------------
//
// Every question, every tool call and every answer, on the console. Asked for so the demo
// can be narrated - but it earns its place afterwards too, because "it said something odd"
// is unanswerable without a record of which tool returned what.

function log(tag, detail) {
  const at = new Date().toISOString().slice(11, 19);
  console.log(`[ask ${at}] ${tag}${detail === undefined ? '' : ` ${detail}`}`);
}

// --- Sessions ------------------------------------------------------------------

const sessions = new Map();

function sweep() {
  const cutoff = Date.now() - IDLE_MINUTES * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.lastUsed < cutoff) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    sessions.delete(oldest[0]);
  }
}

function sessionFor(id) {
  sweep();

  const existing = sessions.get(id);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  const chat = genai().chats.create({
    model: MODEL,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: [...READ_TOOLS, ...ACTION_TOOLS] }]
    }
  });

  const session = { chat, lastUsed: Date.now(), pending: null };
  sessions.set(id, session);
  log('new session', id);
  return session;
}

export function resetSession(id) {
  sessions.delete(id);
  log('session cleared', id);
}

// --- What the dashboard is showing ---------------------------------------------
//
// Sent with every message rather than once at the start, because the person changes the
// plant filter mid-conversation and the model has no way of knowing unless it is told
// again. It is cheap - one short line - and it is what makes "and for Nagpur?" work.

function currentView(filter = {}) {
  const parts = [
    `Plant filter: ${filter.plant && filter.plant !== 'all' ? filter.plant : 'all plants'}`,
    `Screen open: ${filter.screen || 'overview'}`
  ];
  if (filter.from || filter.to) parts.push(`Date range: ${dmy(filter.from) || 'start'} to ${dmy(filter.to) || 'today'}`);
  if (filter.tile) parts.push(`Tile selected: ${filter.tile}`);
  return `[Dashboard is currently showing - ${parts.join('. ')}.]`;
}

// --- When the call itself fails ------------------------------------------------
//
// The SDK throws a wall of JSON. Somebody using the dashboard needs one sentence and,
// where there is one, what to do about it. The free tier matters most here: it allows
// five requests a minute and a single question spends two or three of them, so anybody
// asking two things briskly will meet this - and "429" is not an answer to anyone.

function friendlyError(problem) {
  const raw = String(problem?.message || problem || '');
  const said = /"message":\s*"([^"]+)"/.exec(raw);
  const detail = said ? said[1] : raw;

  if (problem?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    // The two free-tier limits need different sentences. A per-minute one clears while you
    // read the message; the daily one does not clear until midnight, and telling somebody
    // to try again in forty seconds when the answer is "tomorrow" wastes their afternoon.
    // The quota id is the only thing in the reply that says which it was.
    const perDay = /PerDay/i.test(raw);
    const limit = /"quotaValue":\s*"(\d+)"/.exec(raw);

    if (perDay) {
      return (
        `The free daily allowance for the model has run out${limit ? ` (${limit[1]} requests a day)` : ''}, ` +
        'and it does not reset until tomorrow. Answering from the dashboard rules instead.'
      );
    }

    const wait = /retry in ([\d.]+)s/i.exec(detail);
    const seconds = wait ? Math.ceil(Number(wait[1])) : null;
    return (
      'I have hit the free usage limit for this minute. ' +
      (seconds ? `Try again in about ${seconds} seconds.` : 'Try again in a minute.')
    );
  }

  // Several spellings of the same thing. A plain AIza... key that is wrong says "API key
  // not valid"; an OAuth style AQ... token that is wrong says "invalid authentication
  // credentials" instead, and reading only the first leaves somebody with a mistyped key
  // being told the model is unreachable.
  if (
    problem?.status === 401 ||
    /API key not valid|API_KEY_INVALID|unregistered callers|invalid authentication credentials|UNAUTHENTICATED/i.test(
      raw
    )
  ) {
    return 'The key in GEMINI_API_KEY was refused. Check it in .env and restart the backend.';
  }

  if (problem?.status === 404 || /no longer available|not found/i.test(detail)) {
    return (
      `This account cannot use the model ${MODEL}. ` +
      'Set GEMINI_MODEL in .env to one it can, then restart the backend.'
    );
  }

  return `I could not reach the model just now. ${detail}`;
}

// --- The loop ------------------------------------------------------------------

function textOf(response) {
  const text = typeof response.text === 'string' ? response.text : '';
  return text.trim();
}

async function runReadTools(calls, context) {
  const parts = [];

  for (const call of calls) {
    const handler = READ_HANDLERS[call.name];
    log('tool', `${call.name} ${JSON.stringify(call.args || {})}`);

    let result;
    try {
      result = handler
        ? handler(call.args || {}, context)
        : { error: `There is no tool called ${call.name}.` };
    } catch (problem) {
      // A handler that throws must not take the conversation down with it. The model is
      // told the lookup failed, which it can say out loud, rather than being left waiting.
      log('tool failed', `${call.name}: ${problem.message}`);
      result = { error: `That lookup failed: ${problem.message}` };
    }

    log('tool result', `${call.name} -> ${JSON.stringify(result).slice(0, 300)}`);
    parts.push({ functionResponse: { id: call.id, name: call.name, response: result } });
  }

  return parts;
}

/**
 * Ask a question. Returns either { kind: 'answer', text } or { kind: 'proposal', ... }.
 *
 * Never throws. A model that is out of quota, behind a bad key or simply unreachable
 * comes back as a sentence in the conversation, because that is where the person is
 * looking and a stack trace answers nothing.
 */
export async function ask(request) {
  try {
    return await askOnce(request);
  } catch (problem) {
    log('call failed', String(problem?.message || problem).slice(0, 200));
    return { kind: 'answer', ...withoutTheModel(problem, request), failed: true };
  }
}

// What to say when the model cannot be reached.
//
// Saying only "I could not reach the model" would be honest and useless. The dashboard's
// own parser is still here - free, exact, offline, and it already answers what is waiting,
// what is short, what is late, what is part-signed and where an order has got to. So the
// question gets asked of that instead, and the person is told which answered.
//
// This matters most on the free tier, which allows twenty requests a DAY. A demo that goes
// dead halfway through an afternoon is worse than one that never had a model at all.
function withoutTheModel(problem, { question, filter, context }) {
  const note = friendlyError(problem);

  try {
    const fallback = readIntent(question, {
      documents: context.documents,
      materials: context.materials,
      vendors: context.vendors,
      plant: filter?.plant || 'all',
      manager: context.manager,
      memory: {}
    });

    // Only its answers. A proposal from the parser names an endpoint for the browser to
    // call, which is a different confirmation path from the one this panel uses - and two
    // ways to authorise an action is exactly the thing not to improvise here.
    if (fallback?.kind === 'answer' && fallback.text) {
      log('answered without the model', JSON.stringify(fallback.text.slice(0, 120)));
      return { text: `_${note}_\n\n${fallback.text}` };
    }
  } catch (alsoFailed) {
    log('fallback failed too', String(alsoFailed?.message || alsoFailed).slice(0, 160));
  }

  return { text: note };
}

async function askOnce({ sessionId, question, filter, context }) {
  const session = sessionFor(sessionId);
  log('question', JSON.stringify(question));

  let response = await session.chat.sendMessage({
    message: `${currentView(filter)}\n\n${question}`
  });

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const calls = response.functionCalls || [];
    if (calls.length === 0) break;

    // An action stops everything. Even when the model asks for it alongside a read, the
    // whole turn pauses: carrying out half of what it asked for and then waiting would
    // leave the conversation describing a state that only partly happened.
    const action = calls.find((call) => isAction(call.name));
    if (action) {
      const described = describeAction(action.name, action.args || {}, context);
      session.pending = { id: action.id, name: action.name, args: action.args || {} };
      log('proposed', `${action.name} ${JSON.stringify(action.args || {})}`);

      return {
        kind: 'proposal',
        summary: described.summary,
        detail: described.detail,
        confirmLabel: described.confirmLabel,
        tool: action.name
      };
    }

    const parts = await runReadTools(calls, context);
    response = await session.chat.sendMessage({ message: parts });
  }

  if (response.functionCalls?.length) {
    log('gave up', `still calling tools after ${MAX_ROUNDS} rounds`);
    return {
      kind: 'answer',
      text: 'I could not get to an answer on that one. Try asking it a different way, or more narrowly.'
    };
  }

  const text = textOf(response) || 'I have nothing to add to that.';
  log('answer', JSON.stringify(text.slice(0, 200)));
  return { kind: 'answer', text };
}

/**
 * Carry out - or decline - whatever was proposed, then let the model say what happened.
 */
export async function confirm({ sessionId, approved, context }) {
  const session = sessions.get(sessionId);
  if (!session || !session.pending) {
    return { kind: 'answer', text: 'That is no longer waiting to be confirmed. Ask me again and I will set it up.' };
  }

  const pending = session.pending;
  session.pending = null;
  session.lastUsed = Date.now();

  let result;
  if (!approved) {
    log('declined', pending.name);
    result = { done: false, declined: true, message: 'The person declined. Nothing was done.' };
  } else {
    log('confirmed', `${pending.name} ${JSON.stringify(pending.args)}`);
    try {
      result = await ACTION_HANDLERS[pending.name](pending.args, context);
    } catch (problem) {
      log('action failed', `${pending.name}: ${problem.message}`);
      result = { done: false, message: `That did not go through: ${problem.message}` };
    }
    log('action result', JSON.stringify({ ...result, content: undefined }));
  }

  // The file itself never goes to the model - only whether it was produced. Sending a
  // spreadsheet through a language model to have it described back is paying twice for
  // something the browser already has.
  const { content, ...forModel } = result;

  let spoken = null;
  try {
    const response = await session.chat.sendMessage({
      message: [{ functionResponse: { id: pending.id, name: pending.name, response: forModel } }]
    });
    spoken = textOf(response);
  } catch (problem) {
    // It has already been done. Losing the model here changes nothing about that, so
    // the handler's own sentence is what gets said - never silence, and never a claim
    // that it did not happen.
    log('call failed after acting', String(problem?.message || problem).slice(0, 200));
  }

  return {
    kind: 'answer',
    text: spoken || result.message,
    result: { ...result, tool: pending.name }
  };
}

// --- Opening lines -------------------------------------------------------------
//
// Read straight off the data, without the model.
//
// The brief says to call the read tools once and offer two or three specific lines. Putting
// a language model between the data and a sentence like "4 orders have been pending over 7
// days" buys nothing and risks the one thing the whole feature must not do, which is state
// a number that is not true. So these are computed, and they are exact.

export function openers(context) {
  const lines = [];

  const stuck = READ_HANDLERS.list_blocked_pos({ days_pending: 7 }, context);
  if (stuck.count > 0) {
    lines.push({
      text:
        stuck.count === 1
          ? `1 order has been waiting for approval over 7 days, worth ${stuck.total_value}`
          : `${stuck.count} orders have been waiting for approval over 7 days, worth ${stuck.total_value}`,
      ask: 'Which orders have been waiting for approval more than 7 days?'
    });
  }

  const late = context.documents.filter((d) => d.priority?.overdue);
  if (late.length > 0) {
    const worst = late[0];
    lines.push({
      text:
        late.length === 1
          ? `${worst.kind} ${worst.id} is ${Math.abs(worst.priority.daysUntilDue)} days past its delivery date`
          : `${late.length} orders are past their delivery date`,
      ask: 'What is late, and whose side is it late on?'
    });
  }

  const short = context.materials
    .filter((m) => Number(m.shortBy) > 0)
    .sort((a, b) => (Number(a.daysOfCover) || 0) - (Number(b.daysOfCover) || 0));
  if (short.length > 0) {
    const first = short[0];
    lines.push({
      text: `${first.name} at ${first.plant} has ${first.daysOfCover} days of cover left`,
      ask: `How short are we on ${first.name}, and who should we buy it from?`
    });
  }

  const toRaise = (() => {
    const raised = new Set(context.documents.filter((d) => d.kind === 'PO' && d.sourceDocument).map((d) => d.sourceDocument));
    return context.documents.filter((d) => d.kind === 'PR' && d.status === 'approved' && !raised.has(d.id));
  })();
  if (toRaise.length > 0) {
    lines.push({
      text: `${toRaise.length} approved ${toRaise.length === 1 ? 'requisition has' : 'requisitions have'} no purchase order raised yet`,
      ask: 'Which approved requisitions still need a purchase order?'
    });
  }

  log('openers', `${lines.length} available`);
  return lines.slice(0, 3);
}
