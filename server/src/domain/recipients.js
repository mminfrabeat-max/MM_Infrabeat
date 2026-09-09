// Turning a person's name into a mailbox.
//
// This moved here from web/src/format.js, and the move is the whole point of the file.
//
// On the browser side it was a lookup table of real people's personal email addresses,
// compiled into the JavaScript bundle. Anyone who opened the dashboard could read all of
// them from the page source, they were baked into the shareable offline HTML, and they were
// committed to a public repository. The addresses were not secret in any technical sense -
// they were simply published, to everyone, by accident.
//
// Nothing in a browser can hold that data safely, because everything a browser holds is
// visible to whoever is holding it. So the rule this file exists to enforce is: the client
// sends a NAME, the server returns nothing, and the address is known only here.

import { config } from '../config.js';

// Works out where a mail to this person should actually go.
//
// Returns the address and whether it came from the directory, because the difference
// matters to the person pressing Send: one will arrive and the other will bounce, and the
// screen should be able to say which.
export function recipientFor(name) {
  // Names arrive as they are written on screen, sometimes with a role after a comma.
  const asWritten = String(name || '').split(',')[0].trim();
  if (!asWritten) return { address: '', real: false, name: '' };

  const listed = config.mail.directory[asWritten];
  if (listed) return { address: listed, real: true, name: asWritten };

  // Nobody on file, and deliberately no guess.
  //
  // This used to build one from the name - firstname.lastname at the company domain - which
  // was wrong twice over. It produced an address for a mailbox that did not exist, so the
  // mail left and bounced hours later with nobody watching; and it read as genuine to
  // anyone who saw it on screen or in the log, which is how an invented address ends up
  // being copied into something real. An empty address is honest, and the caller sends the
  // message to the operator instead, with a banner saying who it was meant for.
  return { address: '', real: false, name: asWritten };
}
