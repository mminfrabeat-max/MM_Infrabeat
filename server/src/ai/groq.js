// Groq, wearing the same shape as the Gemini chat.
//
// Why a second provider at all: the Gemini free tier is twenty requests a DAY, and a single
// question spends two or three of them. That is about seven questions before the panel goes
// quiet, which is not enough to get through one demonstration. Groq's free tier is a
// thousand a day, and it does tool calling, which is the only thing this design needs.
//
// Why an adapter rather than a rewrite: the loop in assistant.js, the seven tools, the
// system prompt and the confirm-before-acting rule are all provider-agnostic already. The
// only things that differ are the wire format and where the history lives. So this file
// exposes exactly what the Gemini SDK's chat object exposes - sendMessage({ message }),
// returning { text, functionCalls } - and nothing above it has to know which is answering.
//
// The two protocols differ in three ways, and all three are handled here:
//
//   tools      Gemini takes { name, description, parameters } with UPPER CASE type names.
//              OpenAI takes { type: 'function', function: {...} } with lower case ones.
//   calls      Gemini returns functionCalls with parsed args. OpenAI returns tool_calls
//              with arguments as a JSON STRING, which has to be parsed and can be malformed.
//   history    The Gemini SDK keeps it. Here we keep it ourselves, and every assistant turn
//              has to go back in or the model forgets what it just asked for.

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// --- Translating the tool declarations -----------------------------------------

// Lower cases the type names, all the way down. The declarations in tools.js are written
// for Gemini, which wants "OBJECT" and "STRING"; OpenAI's schema wants the JSON Schema
// spelling. Rather than keep two copies of seven tools, they are converted here.
function toJsonSchema(node) {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    // A type can be a name or a list of them. Lower casing only the first form let an
    // upper case one through inside a list, and Groq rejected the whole tool set for it -
    // which reads as the model being unreachable rather than as a schema being wrong.
    if (key === 'type' && typeof value === 'string') out[key] = value.toLowerCase();
    else if (key === 'type' && Array.isArray(value)) out[key] = value.map((t) => String(t).toLowerCase());
    else out[key] = toJsonSchema(value);
  }
  return out;
}

// An optional parameter has to be allowed to be null.
//
// Groq validates the tool call against this schema on its own side, before we ever see it,
// and rejects the whole call if it does not fit. The models here fill every declared
// property whether or not they have a value for it - {"plant": null} rather than leaving
// plant out - so a schema saying plant is a string rejected every single call, and the
// panel fell back to the built-in parser on every question while looking like it worked.
//
// Gemini neither needs nor accepts this, which is why it is done here on the way out
// rather than written into the declarations the two providers share.
function allowNulls(parameters) {
  const required = new Set(parameters.required || []);
  const properties = {};

  for (const [name, shape] of Object.entries(parameters.properties || {})) {
    properties[name] =
      required.has(name) || !shape.type || Array.isArray(shape.type)
        ? shape
        : { ...shape, type: [shape.type, 'null'] };
  }

  return { ...parameters, properties };
}

export function toolsForGroq(declarations) {
  return declarations.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: allowNulls(toJsonSchema(tool.parameters))
    }
  }));
}

// --- Reading what came back ----------------------------------------------------

// OpenAI hands arguments back as a string of JSON. A model that produces a broken one must
// not take the conversation down with it: the call is kept with empty arguments, the handler
// says it cannot find what was asked for, and the model gets a chance to try again.
function argumentsOf(call, log) {
  const raw = call.function?.arguments;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    log?.('bad arguments', `${call.function?.name}: ${String(raw).slice(0, 120)}`);
    return {};
  }
}

// --- The chat ------------------------------------------------------------------

/**
 * A chat session against Groq that answers to the same two things the Gemini one does:
 * `sendMessage({ message })` where message is a string or an array of functionResponse
 * parts, resolving to something with `.text` and `.functionCalls`.
 */
export function createGroqChat({ apiKey, model, systemInstruction, tools, log = () => {} }) {
  const wireTools = toolsForGroq(tools);

  // Ours to keep. The system instruction goes in once, at the front, and stays there.
  const history = [{ role: 'system', content: systemInstruction }];

  // How much of the conversation goes back each time.
  //
  // Everything does, by default - that is what a chat is - and on a tier metered at eight
  // thousand tokens a minute it is what runs the budget down: by the fourth question the
  // first question's tool results are still being paid for, every turn.
  //
  // So only the recent turns are sent. The cut is made at a user message, never inside an
  // exchange: an assistant message asking for a tool and the tool's reply have to travel
  // together or the request is rejected for a tool reply that answers nothing.
  const KEEP_TURNS = 3;

  function toSend() {
    const starts = [];
    for (let i = 1; i < history.length; i += 1) {
      if (history[i].role === 'user') starts.push(i);
    }
    if (starts.length <= KEEP_TURNS) return history;

    const from = starts[starts.length - KEEP_TURNS];
    return [history[0], ...history.slice(from)];
  }

  async function post() {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: toSend(),
        tools: wireTools,
        tool_choice: 'auto',
        // Low, not zero. This is a dashboard: the same question asked twice should give the
        // same answer, and there is nothing here worth being creative about.
        temperature: 0.2
      })
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.error) {
      // Thrown in the shape assistant.js already knows how to describe, so one friendlyError
      // covers both providers - including the quota wording, which is the message anybody
      // on a free tier reads most.
      const problem = new Error(JSON.stringify(body.error || body));
      problem.status = response.status;
      throw problem;
    }

    return body;
  }

  return {
    async sendMessage({ message }) {
      if (typeof message === 'string') {
        history.push({ role: 'user', content: message });
      } else {
        // Results of tools we just ran. One tool message each, tied back by id.
        for (const part of message) {
          const fn = part.functionResponse;
          if (!fn) continue;
          history.push({
            role: 'tool',
            tool_call_id: fn.id,
            name: fn.name,
            content: JSON.stringify(fn.response)
          });
        }
      }

      const body = await post();
      const reply = body.choices?.[0]?.message || {};

      // Back into the history before anything else happens. Leaving it out means the model
      // is told the result of a tool call it has no memory of asking for, and it answers by
      // asking for the same one again.
      history.push(reply);

      const calls = (reply.tool_calls || []).map((call) => ({
        id: call.id,
        name: call.function?.name,
        args: argumentsOf(call, log)
      }));

      return {
        text: typeof reply.content === 'string' ? reply.content : '',
        functionCalls: calls
      };
    }
  };
}
