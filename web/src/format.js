// Turning numbers into something a manager reads without effort.
//
// The backend has its own small copy of money() for sentences it writes. See the note
// at the top of server/src/domain/format.js for why two copies is the right trade.

// Indian numbering: 1 crore = 10,000,000 and 1 lakh = 100,000.
// Short form here ("1.09 cr") because these appear in tables and tiles where space is tight.
export function money(value) {
  if (value === null || value === undefined) return '–';
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

// The exact figure, for places where rounding to crores would hide what matters,
// such as a unit price.
export function rupees(value) {
  if (value === null || value === undefined) return '–';
  return `₹${value.toLocaleString('en-IN')}`;
}

export function number(value) {
  if (value === null || value === undefined) return '–';
  return value.toLocaleString('en-IN');
}

// Always shows the sign, because "+6.3%" and "6.3%" mean different things here.
export function signedPercent(value) {
  if (value === null || value === undefined) return '–';
  return `${value > 0 ? '+' : ''}${value}%`;
}

export function plural(count, word, pluralWord) {
  const many = pluralWord || `${word}s`;
  return `${count} ${count === 1 ? word : many}`;
}

// "Order" and "Request" rather than the two-letter codes used inside SAP.
export function documentTypeLabel(type) {
  return type === 'request' ? 'Request' : 'Order';
}

// Initials for the small round avatars, e.g. "Aditya Refractories" becomes "AR".
export function initials(name) {
  const parts = String(name).replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  const first = (parts[0] || '?').charAt(0);
  const second = parts[1] ? parts[1].charAt(0) : '';
  return (first + second).toUpperCase();
}
