// Enough markdown for an assistant's reply, and no more.
//
// Written rather than installed, for one reason: every renderer worth installing eventually
// offers to set raw HTML, and this text comes from a language model which is in turn
// repeating things typed by people. Nothing here can produce markup. The worst a malicious
// vendor name can do is appear in bold.
//
// What it handles is what the system prompt asks the model to produce: a line of text, then
// a table when there is more than one record. Bullets, numbers, headings, bold, italic and
// inline code come along because they cost four lines each and the model uses them anyway.
//
// What it deliberately does not handle: links, images, raw HTML, block quotes, nested lists.
// A reply that needs a nested list is a reply that is too long.

// --- Inline: bold, italic, code ------------------------------------------------

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*)/g;

function Inline({ text }) {
  return (
    <>
      {String(text ?? '')
        .split(INLINE)
        .filter((part) => part !== '')
        .map((part, i) => {
          if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
            return <b key={i}>{part.slice(2, -2)}</b>;
          }
          if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
            return <code key={i} className="mdcode">{part.slice(1, -1)}</code>;
          }
          if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            return <i key={i}>{part.slice(1, -1)}</i>;
          }
          return <span key={i}>{part}</span>;
        })}
    </>
  );
}

// --- Tables --------------------------------------------------------------------

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);

// The ruled line under a header: |---|:--:|. It carries the alignment and nothing else.
const isRule = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-');

function cellsOf(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function alignmentsOf(rule) {
  return cellsOf(rule).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function Table({ rows }) {
  const [head, rule, ...body] = rows;
  const align = isRule(rule) ? alignmentsOf(rule) : [];
  const lines = isRule(rule) ? body : [rule, ...body].filter(Boolean);

  return (
    // Its own scroller, because a five column table inside a 420px panel has to go
    // somewhere and the panel itself must not scroll sideways.
    <div className="mdtablewrap">
      <table className="mdtable">
        <thead>
          <tr>
            {cellsOf(head).map((cell, i) => (
              <th key={i} style={{ textAlign: align[i] || 'left' }}>
                <Inline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, r) => (
            <tr key={r}>
              {cellsOf(line).map((cell, i) => (
                <td key={i} style={{ textAlign: align[i] || 'left' }}>
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- The block reader ----------------------------------------------------------
//
// One pass down the lines, gathering runs of the same kind of thing. Tables and lists are
// runs; everything else is a line on its own.

export default function Markdown({ text }) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let at = 0;

  while (at < lines.length) {
    const line = lines[at];

    if (!line.trim()) {
      at += 1;
      continue;
    }

    if (isTableRow(line)) {
      const rows = [];
      while (at < lines.length && isTableRow(lines[at])) {
        rows.push(lines[at]);
        at += 1;
      }
      // A single ruleless row is not a table, it is a sentence with pipes in it.
      if (rows.length >= 2) {
        blocks.push({ kind: 'table', rows });
        continue;
      }
      blocks.push({ kind: 'p', text: rows[0] });
      continue;
    }

    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items = [];
      const numbered = /^\s*\d+[.)]\s+/.test(line);
      while (at < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[at])) {
        items.push(lines[at].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        at += 1;
      }
      blocks.push({ kind: numbered ? 'ol' : 'ul', items });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
      at += 1;
      continue;
    }

    blocks.push({ kind: 'p', text: line });
    at += 1;
  }

  return (
    <div className="md">
      {blocks.map((block, i) => {
        if (block.kind === 'table') return <Table key={i} rows={block.rows} />;
        if (block.kind === 'ul') {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}><Inline text={item} /></li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'ol') {
          return (
            <ol key={i}>
              {block.items.map((item, j) => (
                <li key={j}><Inline text={item} /></li>
              ))}
            </ol>
          );
        }
        if (block.kind === 'h') {
          const Tag = `h${Math.min(block.level + 2, 6)}`;
          return <Tag key={i} className="mdh"><Inline text={block.text} /></Tag>;
        }
        return <p key={i}><Inline text={block.text} /></p>;
      })}
    </div>
  );
}
