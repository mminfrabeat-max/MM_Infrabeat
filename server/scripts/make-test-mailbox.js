// Creates a throwaway test mailbox and prints the .env lines for it.
//
//   node server/scripts/make-test-mailbox.js
//
// Why this exists. Real mail needs a real account, and getting one can stall on things
// that have nothing to do with the code: an App Password Google will not issue, a company
// firewall blocking port 587, an admin policy. That leaves you unable to answer the only
// question that matters while you are building - does the sending actually work?
//
// Ethereal is a mail server that accepts everything and delivers nothing. It hands back a
// URL where you can read the message exactly as it would have arrived, HTML and all. So
// the whole path gets exercised - compose, connect, authenticate, send, log the message id
// - without a single real credential.
//
// It does NOT deliver to anybody. Swap the real settings back before a demo where somebody
// has to receive something.

import nodemailer from 'nodemailer';

const account = await nodemailer.createTestAccount();

console.log('');
console.log('Created a throwaway test mailbox. It lasts a few days and holds nothing real.');
console.log('');
console.log('Paste these over the MAIL_ lines in your .env, then restart the backend:');
console.log('');
console.log(`MAIL_HOST=${account.smtp.host}`);
console.log(`MAIL_PORT=${account.smtp.port}`);
console.log(`MAIL_USER=${account.user}`);
console.log(`MAIL_PASSWORD=${account.pass}`);
console.log('MAIL_FROM=Procurement Dashboard <' + account.user + '>');
console.log('MAIL_TO=' + account.user);
console.log('');
console.log('To read what gets sent, sign in at https://ethereal.email/login with:');
console.log(`  ${account.user}`);
console.log(`  ${account.pass}`);
console.log('');
console.log('Every send also prints a direct preview link in the backend log, so you');
console.log('usually will not need to sign in at all.');
console.log('');
console.log('Keep your Gmail settings somewhere: this replaces them only while testing.');
console.log('');
