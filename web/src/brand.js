// The InfraBeat wordmark, stored as a data URI.
//
// Kept in its own module for one reason: it is a long string of base64 and nobody wants it
// sitting in the middle of a component they are trying to read.
//
// Embedding it rather than loading a file means it is on screen the instant the page
// renders, with no second request and no flash of a missing logo.
//
// If the mark ever looks wrong, replace the string below with the exact one from the
// design file. The <Wordmark> component falls back to a text logo if the image fails to
// load, so a bad string shows clean branding rather than a broken-image icon.

export const WORDMARK =
  'data:image/png;base64,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';

// The company and the person the demo signs in as.
export const COMPANY = 'InfraBeat Technologies Pvt. Ltd.';
export const PRODUCT = 'Procurement dashboard';
export const APPROVER_NAME = 'Vaibhav Naik';

// The head of department's own record, shown in the account panel. In a real deployment
// this would come from the HR system and the SAP user master, not a constant.
export const USER_PROFILE = {
  role: 'Head of Procurement',
  dept: 'Central procurement',
  empId: 'INF-2048',
  sapUser: 'VNAIK',
  mobile: '+91 98220 41756',
  ext: '4102',
  location: 'Pune office, InfraBeat Technologies Pvt. Ltd.',
  reportsTo: 'Mr. Vikram Shah, Director, Operations',
  release: 'Release code 02, orders up to 5 crore',
  plants: 'Pune, Mumbai and Nagpur',
  lastLogin: 'Today at 07:58, Pune office',
  prevLogin: '5 Sep at 18:20, mobile',
  passwordAge: 'changed 74 days ago',
  standIn: 'None set'
};

export const PLANTS = ['Pune', 'Mumbai', 'Nagpur'];
