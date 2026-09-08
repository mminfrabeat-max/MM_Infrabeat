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

// Real mailboxes for the demo.
//
// The people on the dashboard are invented, but a demo is unconvincing if the mail lands
// nowhere. These map an invented name to a colleague who will actually receive it. Anyone
// not listed falls back to a derived name@infrabeat.com address, which is not a real
// mailbox and will bounce - fine for showing the compose box, not for showing delivery.
//
// This is the single place recipients are decided. To change who gets what, edit here.
//
// All seven people who have a mail button now point at one of three real inboxes. They are
// spread by how many buttons reach each person, so no single colleague ends up receiving
// most of the demo: five mails can reach Ganesh, four Hrutik, four Pratik.
export const MAIL_DIRECTORY = {
  // Ganesh: 5 buttons
  'Mr. Anil Deshmukh': 'ganesh.upadhye@infrabeat.com',   // Procurement desk, problems S1, S3, S5
  'Mr. Sunil Kulkarni': 'ganesh.upadhye@infrabeat.com',  // Stores and receiving

  // Hrutik: 4 buttons
  'Mr. Kiran Raghavan': 'hrutik.patil@infrabeat.com',    // Logistics and freight, problem S2
  'Mr. Prakash Nair': 'hrutik.patil@infrabeat.com',      // Raw materials buying
  'Ms. Meera Joshi': 'hrutik.patil@infrabeat.com',       // Packing materials

  // Pratik: 4 buttons
  'Mr. Rahul Kamat': 'pratik.salunke@infrabeat.com',     // Contracts and vendor master, problem S6
  'Mr. Sanjay Bose': 'pratik.salunke@infrabeat.com'      // Spares and refractories, problem S4
};
