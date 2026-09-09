// Sending mail.
//
// The rule this file follows: SENDING EMAIL MUST NEVER BREAK AN ACTION.
//
// If the mail server is slow, misconfigured, or Google is having a bad morning, the
// decision has still been made and is already written to the workbook. Losing that because
// a mail failed would be far worse than not sending the mail. So every function here
// returns a description of what happened instead of throwing, and the caller records that
// description in the action log.

import nodemailer from 'nodemailer';
import { config } from './config.js';
import { money, rupees } from './domain/format.js';
import { totalValue } from './domain/documents.js';
import { recipientFor } from './domain/recipients.js';

// Built once and reused. Creating a transport per email would reconnect to the mail server
// every time, which is slow and looks like abuse from Google's side.
let transport = null;

export function mailConfigured() {
  return Boolean(config.mail.host && config.mail.user && config.mail.password);
}

function getTransport() {
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    // Port 465 is TLS from the first byte. Port 587 starts in plain text and upgrades to
    // TLS immediately after connecting, which nodemailer handles. Getting this wrong is
    // the single most common cause of a connection that just hangs.
    secure: config.mail.port === 465,
    auth: { user: config.mail.user, pass: config.mail.password },

    // Give up rather than hang. Without these, a blocked port leaves the connection
    // waiting with nothing to wait for, and the button says "Sending..." indefinitely -
    // which tells the person nothing and looks like the app is broken.
    //
    // This is not theoretical: Render blocks outbound SMTP on free services, so a
    // deployment there hits exactly this. Ten seconds is long enough for a slow mail
    // server and short enough that a blocked one reports back while you are still looking.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  return transport;
}

// Checks the credentials without sending anything. Called at startup so a wrong password
// is reported once, while you are looking at the terminal, rather than silently on the
// first approval at 4pm.
export async function verifyMail() {
  if (!mailConfigured()) return { ok: false, reason: 'not configured' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describeMailError(error) };
  }
}

// --- Who a message is addressed to, and where it actually lands ---------------

// Where a message to this person actually goes.
//
// Somebody on file gets it at their own mailbox: that is the point of the directory, and it
// is what makes an approval handover look like a handover rather than a screenshot.
//
// Somebody NOT on file would otherwise get a derived address at a domain that does not
// deliver, so the mail would leave, bounce, and nobody would find out until they asked why
// no one replied. Those go to the operator's own mailbox instead, with a banner at the top
// of the message naming who it was meant for. A redirect you can see is fine; a silent one
// is how people come to believe a colleague was written to when they were not.
function addressee(name) {
  const person = recipientFor(name);

  if (person.real) {
    return { box: person.address, intended: person.address, who: person.name, redirected: false };
  }

  return {
    box: config.mail.to || config.mail.user,
    intended: person.address,
    who: person.name,
    redirected: Boolean(person.name)
  };
}

function redirectLineText(who, target) {
  if (!target.redirected) return [];
  return [
    `Meant for      ${who}`,
    `There is no mailbox on file for them, so this came to you instead. Add them to`,
    `MAIL_DIRECTORY in .env to have it delivered.`,
    ''
  ];
}

function redirectLineHtml(who, target) {
  if (!target.redirected) return '';
  return `<div style="padding:9px 14px;background:#FFF6E5;border:1px solid #F0DCB4;border-radius:8px;margin-bottom:16px;font-size:12px;color:#7A5B1E;line-height:1.5">
    <b>Meant for ${escapeHtml(who)}</b><br />
    There is no mailbox on file for them, so this was delivered to you instead of bouncing.
    Add them to MAIL_DIRECTORY in .env to have it reach them.
  </div>`;
}

// --- The decision message ----------------------------------------------------

// The subject says what the reader has to do about it. "Approved" is a record; "For your
// approval" is a job, and it is worth the reader knowing which arrived before they open it.
function subjectFor(document, decision, movedTo) {
  if (movedTo) {
    return `For your approval: ${document.kind} ${document.id}, ${document.supplierName}, ${money(totalValue(document))}`;
  }
  const word = decision === 'approved' ? 'Approved' : 'Sent back';
  return `${word}: ${document.kind} ${document.id}, ${document.supplierName}, ${money(totalValue(document))}`;
}

// Plain text as well as HTML, because some mail clients show only the text version and a
// mail that arrives blank looks broken.
function textBody(document, decision, decidedBy, note, movedTo, target) {
  const s = document.supplierScore;
  const opening = movedTo
    ? `${document.kind} ${document.id} has been approved at the previous step and is now with you for ${movedTo.level || 'approval'}.`
    : `${document.kind} ${document.id} has been ${decision === 'approved' ? 'approved' : 'sent back'}.`;

  const lines = [
    ...redirectLineText(movedTo ? movedTo.name : 'the procurement mailbox', target),
    opening,
    '',
    ...(document.createdBy
      ? [`Raised by       ${document.createdBy.name}${document.createdBy.title ? `, ${document.createdBy.title}` : ''}`, '']
      : []),
    `Vendor          ${document.supplierName}`,
    `Material        ${document.material} (${document.materialCode})`,
    `Plant           ${document.plant}`,
    `Type            ${document.docType}, ${document.trade.toLowerCase()}`,
    `Incoterm        ${document.incoterm}`,
    `Transport       ${document.transport}`,
    '',
    `Basic value     ${money(document.basic)}`,
    `Freight         ${document.freight ? money(document.freight) : 'not applicable'}`,
    `Loading         ${document.loading ? money(document.loading) : 'not applicable'}`,
    `Total payable   ${money(totalValue(document))}`,
    '',
    `Payment terms   ${document.payTerms}`,
    `Cash discount   ${document.cashDiscount}`,
    `Rebate          ${document.rebate}`,
    `Delivery        ${document.deliveryDate}`,
    '',
    `Decided by      ${decidedBy}`,
    `Decided at      ${new Date().toLocaleString('en-IN')}`
  ];

  if (note) lines.push('', `Note            ${note}`);

  if (s?.scored) {
    lines.push(
      '',
      'Vendor record, last ten orders',
      `  Standing            ${s.total} out of 100 (${s.bandLabel})`,
      `  On time             ${s.onTimePercent}%`,
      `  Average delay       ${s.averageDaysLate} days`,
      `  Quality accepted    ${s.averageQuality}%`,
      `  Rate vs contract    ${s.percentOverContract > 0 ? '+' : ''}${s.percentOverContract}%`
    );
  }

  lines.push('', 'Sent by the InfraBeat procurement dashboard.');
  return lines.join('\n');
}

// Inline styles only. Email clients strip <style> blocks, so a stylesheet would simply be
// thrown away by most of them.
function htmlBody(document, decision, decidedBy, note, movedTo, target) {
  const approved = decision === 'approved';
  // Amber rather than green when it has moved on: this is not a receipt, it is a job.
  const accent = movedTo ? '#BE6A00' : approved ? '#0B7D60' : '#C8161D';
  const s = document.supplierScore;

  const row = (label, value) =>
    `<tr>
      <td style="padding:6px 14px 6px 0;color:#5A6B7D;font-size:13px;white-space:nowrap">${label}</td>
      <td style="padding:6px 0;color:#0F1A26;font-size:13px;font-weight:600">${value}</td>
    </tr>`;

  return `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#EEF1F6;padding:24px">
  <div style="max-width:580px;margin:0 auto;background:#fff;border:1px solid #E1E7EE;border-radius:12px;overflow:hidden">
    <div style="background:${accent};color:#fff;padding:16px 22px">
      <div style="font-size:12px;opacity:.85;letter-spacing:.4px;text-transform:uppercase">${
        movedTo ? 'Waiting for your approval' : approved ? 'Approved' : 'Sent back'
      }</div>
      <div style="font-size:19px;font-weight:600;margin-top:2px">${document.kind} ${document.id}</div>
    </div>

    <div style="padding:20px 22px">
      ${redirectLineHtml(movedTo ? movedTo.name : 'the procurement mailbox', target)}

      ${
        movedTo
          ? `<div style="font-size:13.5px;color:#0F1A26;line-height:1.55;margin-bottom:16px">
              ${escapeHtml(decidedBy)} has approved this at the previous step. It now needs
              <b>${escapeHtml(movedTo.level || 'your approval')}</b> from you before it can be released.
            </div>`
          : ''
      }

      <div style="font-size:22px;font-weight:700;color:#0F1A26">${money(totalValue(document))}</div>
      <div style="font-size:13px;color:#5A6B7D;margin-top:2px">${document.supplierName} &middot; ${document.plant} plant &middot; ${document.trade.toLowerCase()}</div>

      <table style="width:100%;border-collapse:collapse;margin-top:18px">
        ${document.createdBy ? row('Raised by', `${document.createdBy.name}${document.createdBy.title ? `, ${document.createdBy.title}` : ''}`) : ''}
        ${row('Material', `${document.material} (${document.materialCode})`)}
        ${row('Document type', document.docType)}
        ${row('Incoterm', document.incoterm)}
        ${row('Transport', document.transport)}
        ${row('Basic value', money(document.basic))}
        ${row('Freight', document.freight ? money(document.freight) : 'not applicable')}
        ${row('Loading', document.loading ? money(document.loading) : 'not applicable')}
        ${row('Payment terms', document.payTerms)}
        ${row('Delivery', document.deliveryDate)}
        ${row('Decided by', decidedBy)}
        ${row('Decided at', new Date().toLocaleString('en-IN'))}
        ${note ? row('Note', note) : ''}
      </table>

      ${
        s?.scored
          ? `<div style="margin-top:20px;padding:14px 16px;background:#F7F9FC;border:1px solid #E1E7EE;border-radius:9px">
              <div style="font-size:12px;font-weight:700;color:#5A6B7D;text-transform:uppercase;letter-spacing:.4px">Vendor record, last ten orders</div>
              <div style="font-size:26px;font-weight:700;color:${s.band === 'good' ? '#0B7D60' : s.band === 'watch' ? '#BE6A00' : '#C8161D'};margin-top:6px">${s.total}<span style="font-size:13px;color:#8695A6;font-weight:600"> / 100 &middot; ${s.bandLabel}</span></div>
              <table style="width:100%;border-collapse:collapse;margin-top:8px">
                ${row('On time', `${s.onTimePercent}%`)}
                ${row('Average delay', `${s.averageDaysLate} days`)}
                ${row('Quality accepted', `${s.averageQuality}%`)}
                ${row('Rate vs contract', `${s.percentOverContract > 0 ? '+' : ''}${s.percentOverContract}%`)}
              </table>
            </div>`
          : ''
      }

      <p style="font-size:11.5px;color:#8695A6;margin:20px 0 0;line-height:1.5">
        Sent automatically by the InfraBeat procurement dashboard when the decision was recorded.
      </p>
    </div>
  </div>
</div>`;
}

// --- Sending ------------------------------------------------------------------

// Returns { sent, to, status } and never throws. The status string goes straight into the
// workbook's action log, so there is a permanent record of whether the mail left.
// `movedTo` is the approver the document has just been passed to, or null when the decision
// finished it. When it is set, this message stops being a record of what happened and
// becomes the request that the next person act - same facts, different job.
export async function sendDecisionEmail({ document, decision, decidedBy, note, movedTo = null }) {
  // Addressed by NAME. The address on the document is only ever a display value; the
  // directory on this side is what decides where a message goes.
  const target = movedTo
    ? addressee(movedTo.name)
    : { box: config.mail.to || config.mail.user, intended: '', who: '', redirected: false };
  const to = target.box || decidedBy;

  if (!mailConfigured()) {
    return { sent: false, to, status: 'Not sent: email is not configured in .env' };
  }

  try {
    const info = await getTransport().sendMail({
      from: config.mail.from || config.mail.user,
      to,
      // A next approver who has a question should be able to ask the person who approved
      // it, not the dashboard. A plain record has nobody to reply to.
      ...(movedTo ? { replyTo: decidedBy } : {}),
      subject: subjectFor(document, decision, movedTo),
      text: textBody(document, decision, decidedBy, note, movedTo, target),
      html: htmlBody(document, decision, decidedBy, note, movedTo, target)
    });
    return {
      sent: true,
      to,
      delivered: !target.redirected,
      status: `Sent ${info.messageId || ''}`.trim(),
      preview: previewLink(info)
    };
  } catch (error) {
    return { sent: false, to, status: `Not sent: ${describeMailError(error)}` };
  }
}

// --- The note back to whoever raised the document -----------------------------

// The buyer who raised a document hears nothing today. They find out it moved by opening
// SAP and looking, or by asking. This is the message that saves them the trip.
//
// It is deliberately not the message above. The next approver needs the vendor's record and
// the rate against contract, because they have a decision to make. The buyer has no
// decision to make and does not need any of it: they need to know it moved, who has it now,
// and what was said. Sending them the full sheet would bury those three facts.
//
// Nothing in it invites a reply, and Reply-To says so, because a reply would arrive
// nowhere. The headers are the standard way of telling other mail systems the same thing,
// so an out-of-office does not bounce back at us forever.
export async function sendInitiatorEmail({ document, outcome, decidedBy, note, sentence }) {
  const raiser = document.createdBy;
  const target = addressee(raiser ? raiser.name : '');
  const to = target.box;

  if (!raiser) {
    return { sent: false, to, status: 'Not sent: nobody is recorded as having raised this document' };
  }
  if (!mailConfigured()) {
    return { sent: false, to, status: 'Not sent: email is not configured in .env' };
  }

  try {
    const info = await getTransport().sendMail({
      from: config.mail.from || config.mail.user,
      to,
      // Omitted entirely when there is no address to use, rather than falling back to
      // something invented.
      ...(config.mail.noReply ? { replyTo: config.mail.noReply } : {}),
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All'
      },
      subject: initiatorSubject(document, outcome),
      text: initiatorText(document, outcome, decidedBy, note, sentence, target, raiser),
      html: initiatorHtml(document, outcome, decidedBy, note, sentence, target, raiser)
    });
    return {
      sent: true,
      to,
      delivered: !target.redirected,
      status: `Sent ${info.messageId || ''}`.trim(),
      preview: previewLink(info)
    };
  } catch (error) {
    return { sent: false, to, status: `Not sent: ${describeMailError(error)}` };
  }
}

function initiatorSubject(document, outcome) {
  if (outcome.status === 'rejected') return `Sent back: your ${document.kind} ${document.id}`;
  if (outcome.final) return `Approved: your ${document.kind} ${document.id}`;
  return `Approved and passed on: your ${document.kind} ${document.id}`;
}

function initiatorText(document, outcome, decidedBy, note, sentence, target, raiser) {
  const lines = [
    ...redirectLineText(raiser.name, target),
    sentence,
    '',
    `Document        ${document.kind} ${document.id}`,
    `Vendor          ${document.supplierName}`,
    `Material        ${document.material} (${document.materialCode})`,
    `Plant           ${document.plant}`,
    `Total payable   ${money(totalValue(document))}`,
    `Delivery        ${document.deliveryDate}`,
    '',
    `Approved by     ${decidedBy}`,
    `Approved at     ${new Date().toLocaleString('en-IN')}`
  ];

  // The note is the reason the mail is worth reading at all. An approval with a condition
  // attached is a different thing from a clean one, and this is where the buyer learns it.
  if (note) lines.push('', `Their note      ${note}`);

  if (outcome.movedTo) {
    lines.push(
      '',
      'Now waiting with',
      `  ${outcome.movedTo.name}${outcome.movedTo.title ? `, ${outcome.movedTo.title}` : ''}`,
      `  ${outcome.movedTo.level || 'next approval step'}`
    );
    if (outcome.movedTo.email) lines.push(`  ${outcome.movedTo.email}`);
  }

  lines.push(
    '',
    'This message is for your information only. Nothing is needed from you, and this',
    'mailbox is not monitored, so please do not reply to it.',
    '',
    'Sent by the InfraBeat procurement dashboard.'
  );

  return lines.join('\n');
}

function initiatorHtml(document, outcome, decidedBy, note, sentence, target, raiser) {
  const accent = outcome.status === 'rejected' ? '#C8161D' : outcome.final ? '#0B7D60' : '#1E5FA8';

  const row = (label, value) =>
    `<tr>
      <td style="padding:6px 14px 6px 0;color:#5A6B7D;font-size:13px;white-space:nowrap">${label}</td>
      <td style="padding:6px 0;color:#0F1A26;font-size:13px;font-weight:600">${value}</td>
    </tr>`;

  return `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#EEF1F6;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E1E7EE;border-radius:12px;overflow:hidden">
    <div style="background:${accent};color:#fff;padding:16px 22px">
      <div style="font-size:12px;opacity:.85;letter-spacing:.4px;text-transform:uppercase">For your information</div>
      <div style="font-size:19px;font-weight:600;margin-top:2px">${document.kind} ${document.id}</div>
    </div>

    <div style="padding:20px 22px">
      ${redirectLineHtml(raiser.name, target)}

      <div style="font-size:14px;color:#0F1A26;line-height:1.6">${escapeHtml(sentence)}</div>

      <table style="width:100%;border-collapse:collapse;margin-top:18px">
        ${row('Vendor', escapeHtml(document.supplierName))}
        ${row('Material', escapeHtml(`${document.material} (${document.materialCode})`))}
        ${row('Plant', escapeHtml(document.plant))}
        ${row('Total payable', money(totalValue(document)))}
        ${row('Delivery', escapeHtml(document.deliveryDate))}
        ${row('Approved by', escapeHtml(decidedBy))}
        ${row('Approved at', new Date().toLocaleString('en-IN'))}
      </table>

      ${
        note
          ? `<div style="margin-top:16px;padding:12px 14px;background:#F7F9FC;border-left:3px solid ${accent};border-radius:0 8px 8px 0">
              <div style="font-size:11.5px;font-weight:700;color:#5A6B7D;text-transform:uppercase;letter-spacing:.4px">Note added on approval</div>
              <div style="font-size:13.5px;color:#0F1A26;margin-top:5px;line-height:1.55;white-space:pre-wrap">${escapeHtml(note)}</div>
            </div>`
          : ''
      }

      ${
        outcome.movedTo
          ? `<div style="margin-top:18px;padding:14px 16px;background:#F2F7FD;border:1px solid #CFE0F3;border-radius:9px">
              <div style="font-size:11.5px;font-weight:700;color:#1E5FA8;text-transform:uppercase;letter-spacing:.4px">Now waiting with</div>
              <div style="font-size:15px;font-weight:700;color:#0F1A26;margin-top:5px">${escapeHtml(outcome.movedTo.name)}</div>
              <div style="font-size:12.5px;color:#5A6B7D;margin-top:2px">
                ${[outcome.movedTo.title, outcome.movedTo.level].filter(Boolean).map(escapeHtml).join(' &middot; ')}
              </div>
              ${outcome.movedTo.email ? `<div style="font-size:12.5px;color:#5A6B7D;margin-top:2px">${escapeHtml(outcome.movedTo.email)}</div>` : ''}
            </div>`
          : ''
      }

      <p style="font-size:11.5px;color:#8695A6;margin:20px 0 0;line-height:1.5">
        For your information only. Nothing is needed from you. This mailbox is not
        monitored, so please do not reply to this message.
      </p>
    </div>
  </div>
</div>`;
}

// A plain mail the manager typed themselves, from the Write a mail box.
export async function sendPlainEmail({ to, subject, body, from }) {
  if (!mailConfigured()) {
    return { sent: false, to, status: 'Not sent: email is not configured in .env' };
  }

  try {
    const info = await getTransport().sendMail({
      from: config.mail.from || config.mail.user,
      to,
      // So a reply goes to the person who wrote it, not the dashboard's own mailbox.
      replyTo: from,
      subject,
      text: body,
      html: `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0F1A26;white-space:pre-wrap">${escapeHtml(body)}</div>`
    });
    return { sent: true, to, status: `Sent ${info.messageId || ''}`.trim(), preview: previewLink(info) };
  } catch (error) {
    return { sent: false, to, status: `Not sent: ${describeMailError(error)}` };
  }
}

// When the mail went to a test mailbox rather than a real one, this is the URL where you
// can read it. Real mail servers return nothing here, so the link is simply absent and
// nothing downstream has to care which kind of server was used.
function previewLink(info) {
  const url = nodemailer.getTestMessageUrl(info);
  if (!url) return null;
  // Printed as well as returned: the terminal is where you are looking when testing.
  console.log(`[api] mail preview: ${url}`);
  return url;
}

// The body is typed by a person, so it must never be treated as markup.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Turns nodemailer's errors into something a person can act on. These four cover almost
// everything that goes wrong with Gmail in practice.
function describeMailError(error) {
  const text = String(error.message || error);

  if (error.code === 'EAUTH' || /invalid login|username and password not accepted/i.test(text)) {
    return 'the mail server rejected the username or password. For Gmail you must use a 16-character App Password, not your normal password.';
  }
  if (error.code === 'ECONNECTION' || error.code === 'ESOCKET') {
    return `could not connect to ${config.mail.host}:${config.mail.port}. Check the host and port, and whether a firewall is blocking it.`;
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET' || /timeout|timed out/i.test(text)) {
    return (
      `nothing answered on ${config.mail.host}:${config.mail.port} within ten seconds. ` +
      'Something between here and the mail server is blocking the port. Render blocks ' +
      'outbound SMTP on free services, and company networks often block 587 too. Either ' +
      'move to a paid instance, or send through a mail API over HTTPS instead of SMTP.'
    );
  }
  if (error.code === 'EENVELOPE') {
    return 'the recipient address was rejected. Check the address you typed.';
  }
  return text;
}
