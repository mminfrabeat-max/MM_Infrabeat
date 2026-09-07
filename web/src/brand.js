// Who this dashboard belongs to, and who is using it.

// The wordmark lives in web/public, so Vite serves it from the site root. Keeping it as a
// file rather than embedding it means you can replace the artwork without touching code:
// drop a new file in that folder and change this one line.
export const LOGO = '/infrabeat-logo.svg';

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
