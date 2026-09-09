
// Turning numbers and names into something a manager reads without effort.
//
// The backend has its own small copy of money() for the sentences it writes. Two small
// copies is deliberate: the alternative is the backend sending half-built sentences with
// placeholders for the frontend to fill in, which is far more code.

// Indian numbering: 1 crore = 10,000,000 and 1 lakh = 100,000. Short form, because these
// appear in tables and tiles where space is tight.
export function inr(value) {
  if (value === null || value === undefined || value === '') return '–';
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// The exact figure, for places where rounding to crores would hide what matters, such as
// a unit price.
export function rupees(value) {
  if (value === null || value === undefined) return '–';
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

export function num(value) {
  if (value === null || value === undefined || value === '') return '–';
  return Number(value).toLocaleString('en-IN');
}

// Always shows the sign, because "+6.3%" and "6.3%" mean different things here.
export function signed(value) {
  if (value === null || value === undefined) return '–';
  return `${value > 0 ? '+' : ''}${value}%`;
}

export function plural(count, word, pluralWord) {
  const many = pluralWord || `${word}s`;
  return `${count} ${count === 1 ? word : many}`;
}

// "Aditya Refractories" becomes "AR". Titles are stripped so "Mr. Anil Deshmukh" is "AD".
export function initials(name) {
  const parts = String(name)
    .replace(/^(Mr|Ms|Mrs)\.?\s+/i, '')
    .replace(/[.,]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const first = (parts[0] || '?').charAt(0);
  const second = parts[1] ? parts[1].charAt(0) : '';
  return (first + second).toUpperCase();
}

export function clock() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function firstName(fullName) {
  return String(fullName).replace(/^(Mr|Ms|Mrs)\.?\s+/i, '').split(' ')[0];
}

// There is no mailAddressFor here any more.
//
// It used to turn a name into an email address, using a table of real people's mailboxes
// that shipped inside this bundle. That lookup now lives in server/src/domain/recipients.js
// where the browser cannot read it. Screens pass the person's NAME to the compose box, and
// the backend works out the address when the mail is actually sent.

// The backend speaks in business words (good / watch / risk). The stylesheet speaks in
// colours (pos / warn / neg). This is the one place that translates between them.
export function bandTone(band) {
  if (band === 'good') return 'pos';
  if (band === 'watch') return 'warn';
  if (band === 'risk') return 'neg';
  return 'mut';
}
