// Who this dashboard belongs to, and who is using it.

// The wordmark lives in web/public, so Vite serves it from the site root. Keeping it as a
// file rather than embedding it means you can replace the artwork without touching code:
// drop a new file in that folder and change this one line.
export const LOGO = '/infrabeat-logo.png';

export const COMPANY = 'InfraBeat Technologies Pvt. Ltd.';
export const PRODUCT = 'Procurement dashboard';
// The one place the approver's name is written. The greeting, the avatar initials, the
// account panel, the approval chain and the signature on every mail all read from here.
export const APPROVER_NAME = 'Arjun P';

// The head of department's own record, shown in the account panel. In a real deployment
// this would come from the HR system and the SAP user master, not a constant.
export const USER_PROFILE = {
  // Shown in the account panel and signed at the bottom of every mail sent from here.
  role: 'Procurement Manager',
  dept: 'Central procurement',
  empId: 'INF-2048',
  sapUser: 'ARJUNP',
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
