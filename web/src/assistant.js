// The chips under the Ask box.
//
// The answering itself used to live here, in the browser, as pattern matching over the data
// already on screen. It moved to the server when Ask learned to do things rather than only
// describe them: anything the browser decides is decided by whoever is holding the browser,
// and "approve this order" is not a decision a page should be able to make on its own.
//
// What is left is this list. It is worth keeping deliberately: the chips are how anybody
// finds out what Ask can do, so each one should be a real thing it can answer, and between
// them they should cover the range - a question about work waiting, a question about stock,
// a question that asks for advice, and one that changes the whole screen.
//
// The rules Ask actually follows are in server/src/domain/ask.js.

export const SUGGESTIONS = [
  'What is waiting for me?',
  'What will run out first?',
  'Where are my shipments?',
  'Which vendor should I use for gypsum?',
  'Can I trust Aditya?',
  'Show only Pune'
];
