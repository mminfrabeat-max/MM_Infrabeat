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
    auth: { user: config.mail.user, pass: config.mail.password }
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

// --- The decision message ----------------------------------------------------

function subjectFor(document, decision) {
  const word = decision === 'approved' ? 'Approved' : 'Sent back';
  return `${word}: ${document.kind} ${document.id}, ${document.supplierName}, ${money(totalValue(document))}`;
}

// Plain text as well as HTML, because some mail clients show only the text version and a
// mail that arrives blank looks broken.
function textBody(document, decision, decidedBy, note) {
  const s = document.supplierScore;
  const lines = [
    `${document.kind} ${document.id} has been ${decision === 'approved' ? 'approved' : 'sent back'}.`,
    '',
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
function htmlBody(document, decision, decidedBy, note) {
  const approved = decision === 'approved';
  const accent = approved ? '#0B7D60' : '#C8161D';
  const s = document.supplierScore;

  const row = (label, value) =>
    `<tr>
      <td style="padding:6px 14px 6px 0;color:#5A6B7D;font-size:13px;white-space:nowrap">${label}</td>
      <td style="padding:6px 0;color:#0F1A26;font-size:13px;font-weight:600">${value}</td>
    </tr>`;

  return `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#EEF1F6;padding:24px">
  <div style="max-width:580px;margin:0 auto;background:#fff;border:1px solid #E1E7EE;border-radius:12px;overflow:hidden">
    <div style="background:${accent};color:#fff;padding:16px 22px">
      <div style="font-size:12px;opacity:.85;letter-spacing:.4px;text-transform:uppercase">${approved ? 'Approved' : 'Sent back'}</div>
      <div style="font-size:19px;font-weight:600;margin-top:2px">${document.kind} ${document.id}</div>
    </div>

    <div style="padding:20px 22px">
      <div style="font-size:22px;font-weight:700;color:#0F1A26">${money(totalValue(document))}</div>
      <div style="font-size:13px;color:#5A6B7D;margin-top:2px">${document.supplierName} &middot; ${document.plant} plant &middot; ${document.trade.toLowerCase()}</div>

      <table style="width:100%;border-collapse:collapse;margin-top:18px">
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
export async function sendDecisionEmail({ document, decision, decidedBy, note }) {
  const to = config.mail.to || decidedBy;

  if (!mailConfigured()) {
    return { sent: false, to, status: 'Not sent: email is not configured in .env' };
  }

  try {
    const info = await getTransport().sendMail({
      from: config.mail.from || config.mail.user,
      to,
      subject: subjectFor(document, decision),
      text: textBody(document, decision, decidedBy, note),
      html: htmlBody(document, decision, decidedBy, note)
    });
    return { sent: true, to, status: `Sent ${info.messageId || ''}`.trim() };
  } catch (error) {
    return { sent: false, to, status: `Not sent: ${describeMailError(error)}` };
  }
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
    return { sent: true, to, status: `Sent ${info.messageId || ''}`.trim() };
  } catch (error) {
    return { sent: false, to, status: `Not sent: ${describeMailError(error)}` };
  }
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
  if (error.code === 'ETIMEDOUT' || /timeout/i.test(text)) {
    return 'the mail server did not answer in time. Port 587 on a company network often needs the IT team to allow it.';
  }
  if (error.code === 'EENVELOPE') {
    return 'the recipient address was rejected. Check the address you typed.';
  }
  return text;
}
