// Turns a password into a hash you can safely put in .env.
//
// Run it from the project root:
//   node server/scripts/hash-password.js "your new password"
// then copy the line it prints into .env and restart the backend.
//
// Why hash at all, for a dashboard only you run? Because a stored password is a password
// that can be read - over your shoulder, in a screenshot, in a backup, by anyone who
// opens the file. A hash cannot be turned back into the password, so there is nothing
// to read. It costs six lines to do this properly.
//
// scrypt is deliberately slow and memory-hungry. That is the point: it makes guessing
// millions of passwords expensive. It is built into Node, so there is no extra package.

import crypto from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error('Usage: node server/scripts/hash-password.js "the password"');
  process.exit(1);
}

// A salt is random text mixed in before hashing. It means two people with the same
// password still get different hashes, so cracking one tells you nothing about the other.
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync(password, salt, 64);

console.log('');
console.log('Copy this line into your .env file:');
console.log('');
console.log(`AUTH_PASSWORD_HASH=scrypt$${salt.toString('hex')}$${key.toString('hex')}`);
console.log('');
