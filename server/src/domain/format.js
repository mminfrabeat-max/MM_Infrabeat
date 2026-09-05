// Number formatting for text the BACKEND writes, such as the recommendation sentence
// on an approval.
//
// The frontend has its own copy of this in web/src/format.js. Two small copies is
// deliberate: the alternative is the backend sending half-built sentences with
// placeholders for the frontend to fill in, which is far more code and far more
// confusing. Six lines duplicated is the cheaper trade.

// Indian numbering: 1 crore = 10,000,000 and 1 lakh = 100,000. A manager here reads
// "1.1 cr" instantly and "11,650,800" not at all.
export function money(value) {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} crore`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} lakh`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function rupees(value) {
  return `₹${value.toLocaleString('en-IN')}`;
}

// "1 approval" / "3 approvals", so sentences read properly.
export function plural(count, word, pluralWord) {
  const many = pluralWord || `${word}s`;
  return `${count} ${count === 1 ? word : many}`;
}
