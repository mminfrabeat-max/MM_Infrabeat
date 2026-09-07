// Sending the email that goes out when a document is approved or rejected.
//
// The rule this file follows: SENDING EMAIL MUST NEVER BREAK AN APPROVAL.
//
// If the mail server is slow, misconfigured, or Google is having a bad morning, the
// approval has still happened and has already been written to the workbook. Losing that
// because a mail failed would be far worse than not sending the mail. So every function
// here returns a description of what happened instead of throwing, and the caller
// records that description in the action log.

import nodemailer from 'nodemailer';
import { config } from './config.js';
import { money, rupees } from './domain/format.js';

// Built once and reused. Creating a transport per email would reconnect to the mail
// server every time, which is slow and looks like abuse from Google's side.
let transport = null;

export function mailConfigured() {
  return Boolean(config.mail.host && config.mail.user && config.mail.password);
}

function getTransport() {
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    // Port 465 is TLS from the first byte. Port 587 starts in plain text and upgrades
    // to TLS immediately after connecting, which nodemailer does for us. Getting this
    // wrong is the single most common cause of a connection that just hangs.
    secure: config.mail.port === 465,
    auth: {
      user: config.mail.user,
      pass: config.mail.password
    }
  });

  return transport;
}

// Checks the credentials without sending anything. Called at startup so a wrong password
// is reported once, at a moment you are looking at the terminal, rather than silently on
// the first approval at 4pm.
export async function verifyMail() {
  if (!mailConfigured()) {
    return { ok: false, reason: 'not configured' };
  }
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describeMailError(error) };
  }
}

// --- The message ------------------------------------------------------------

function subjectFor(document, decision) {
  const word = decision === 'approved' ? 'Approved' : 'Rejected';
  const type = document.type === 'request' ? 'Request' : 'Order';
  return `${word}: ${type} ${document.id}, ${document.supplierName}, ${money(document.value)}`;
}

// Plain text as well as HTML, because some mail clients show only the text version and
// a mail that arrives blank looks broken.
function textBody(document, decision, decidedBy, note) {
  const type = document.type === 'request' ? 'Request' : 'Order';
  const lines = [
    `${type} ${document.id} has been ${decision}.`,
    '',
    `Supplier      ${document.supplierName}`,
    `Material      ${document.material} (${document.materialCode})`,
    `Plant         ${document.plant}`,
    `Quantity      ${document.quantity} ${document.unit}`,
    `Price         ${rupees(document.rate)} per ${document.unit}`,
    `Total value   ${money(document.value)}`,
    `Delivery      ${document.deliveryDate}`,
    '',
    `Decided by    ${decidedBy}`,
    `Decided at    ${new Date().toLocaleString('en-IN')}`
  ];

  if (note) lines.push('', `Note          ${note}`);

  if (document.supplierScore?.scored) {
    const s = document.supplierScore;
    lines.push(
      '',
      'Supplier record, last ten orders',
      `  Reliability score   ${s.total} out of 100 (${s.bandLabel})`,
      `  Delivered on time   ${s.onTimePercent}%`,
      `  Average delay       ${s.averageDaysLate} days`,
      `  Quality accepted    ${s.averageQuality}%`,
      `  Price vs agreement  ${s.percentOverContract > 0 ? '+' : ''}${s.percentOverContract}%`
    );
  }

  lines.push('', 'Sent by the procurement dashboard.');
  return lines.join('\n');
}

// Inline styles only. Email clients strip <style> blocks, so a stylesheet would simply
// be thrown away by most of them.
function htmlBody(document, decision, decidedBy, note) {
  const approved = decision === 'approved';
  const accent = approved ? '#1e8e3e' : '#c62828';
  const type = document.type === 'request' ? 'Request' : 'Order';
  const s = document.supplierScore;

  const row = (label, value) =>
    `<tr>
      <td style="padding:6px 14px 6px 0;color:#5a6b7d;font-size:13px;white-space:nowrap">${label}</td>
      <td style="padding:6px 0;color:#0f1a26;font-size:13px;font-weight:600">${value}</td>
    </tr>`;

  return `<div style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f6f8;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e1e7ee;border-radius:12px;overflow:hidden">
    <div style="background:${accent};color:#fff;padding:16px 22px">
      <div style="font-size:12px;opacity:.85;letter-spacing:.4px;text-transform:uppercase">${approved ? 'Approved' : 'Rejected'}</div>
      <div style="font-size:19px;font-weight:600;margin-top:2px">${type} ${document.id}</div>
    </div>

    <div style="padding:20px 22px">
      <div style="font-size:22px;font-weight:700;color:#0f1a26">${money(document.value)}</div>
      <div style="font-size:13px;color:#5a6b7d;margin-top:2px">${document.supplierName}</div>

      <table style="width:100%;border-collapse:collapse;margin-top:18px">
        ${row('Material', `${document.material} (${document.materialCode})`)}
        ${row('Plant', document.plant)}
        ${row('Quantity', `${document.quantity} ${document.unit}`)}
        ${row('Price', `${rupees(document.rate)} per ${document.unit}`)}
        ${row('Delivery', document.deliveryDate)}
        ${row('Decided by', decidedBy)}
        ${row('Decided at', new Date().toLocaleString('en-IN'))}
        ${note ? row('Note', note) : ''}
      </table>

      ${
        s?.scored
          ? `<div style="margin-top:20px;padding:14px 16px;background:#f7f9fc;border:1px solid #e1e7ee;border-radius:9px">
              <div style="font-size:12px;font-weight:700;color:#5a6b7d;text-transform:uppercase;letter-spacing:.4px">Supplier record, last ten orders</div>
              <div style="font-size:26px;font-weight:700;color:${s.band === 'good' ? '#1e8e3e' : s.band === 'watch' ? '#e76500' : '#c62828'};margin-top:6px">${s.total}<span style="font-size:13px;color:#8695a6;font-weight:600"> / 100 &middot; ${s.bandLabel}</span></div>
              <table style="width:100%;border-collapse:collapse;margin-top:8px">
                ${row('Delivered on time', `${s.onTimePercent}%`)}
                ${row('Average delay', `${s.averageDaysLate} days`)}
                ${row('Quality accepted', `${s.averageQuality}%`)}
                ${row('Price vs agreement', `${s.percentOverContract > 0 ? '+' : ''}${s.percentOverContract}%`)}
              </table>
            </div>`
          : ''
      }

      <p style="font-size:11.5px;color:#8695a6;margin:20px 0 0;line-height:1.5">
        Sent automatically by the procurement dashboard when the decision was recorded.
      </p>
    </div>
  </div>
</div>`;
}

// --- Sending ----------------------------------------------------------------

// Returns { sent, to, status } and never throws. The status string goes straight into
// the workbook's action log, so there is a permanent record of whether the mail left.
export async function sendDecisionEmail({ document, decision, decidedBy, note }) {
  const to = config.mail.to || decidedBy;

  if (!mailConfigured()) {
    return {
      sent: false,
      to,
      status: 'Not sent: email is not configured in .env'
    };
  }

  try {
    const info = await getTransport().sendMail({
      from: config.mail.from || config.mail.user,
      to,
      subject: subjectFor(document, decision),
      text: textBody(document, decision, decidedBy, note),
      html: htmlBody(document, decision, decidedBy, note)
    });

    return {
      sent: true,
      to,
      // The message id is what you quote when asking a mail admin where something went.
      status: `Sent ${info.messageId || ''}`.trim()
    };
  } catch (error) {
    return { sent: false, to, status: `Not sent: ${describeMailError(error)}` };
  }
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
    return 'the mail server did not answer in time. Port 587 with a company network often needs the IT team to allow it.';
  }
  if (error.code === 'EENVELOPE') {
    return 'the recipient address was rejected. Check MAIL_TO in your .env.';
  }
  return text;
}
