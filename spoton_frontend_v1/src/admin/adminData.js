// ─── Admin mock data ──────────────────────────────────────────────────────────

export const ADMIN_STATUS = {
  AVAILABLE: 'available',
  RESERVED:  'reserved',
  ACTIVE:    'active',
  TEMP:      'temp',
  REVIEW:    'review',
};

export const INITIAL_ADMIN_SPACES = [
  { id: 'V01', status: ADMIN_STATUS.AVAILABLE, unit: null,  visitor: null,  plate: null,     permit: null,        from: null,       until: null },
  { id: 'V02', status: ADMIN_STATUS.ACTIVE,    unit: '8',   visitor: 'Sam', plate: 'LMN456', permit: 'SP-1038',   from: '1:00 PM',  until: '4:00 PM' },
  { id: 'V03', status: ADMIN_STATUS.RESERVED,  unit: '3',   visitor: null,  plate: null,     permit: 'SP-1039',   from: '3:00 PM',  until: '6:00 PM' },
  { id: 'V04', status: ADMIN_STATUS.AVAILABLE, unit: null,  visitor: null,  plate: null,     permit: null,        from: null,       until: null },
  { id: 'V05', status: ADMIN_STATUS.ACTIVE,    unit: '21',  visitor: 'Mia', plate: 'QRS789', permit: 'SP-1040',   from: '12:00 PM', until: '5:30 PM' },
  { id: 'V06', status: ADMIN_STATUS.TEMP,      unit: '17',  visitor: 'Contractor', plate: 'TMP001', permit: 'SP-TEMP-02', from: 'Now', until: '6:00 PM' },
  { id: 'V07', status: ADMIN_STATUS.AVAILABLE, unit: null,  visitor: null,  plate: null,     permit: null,        from: null,       until: null },
  { id: 'V08', status: ADMIN_STATUS.ACTIVE,    unit: '29',  visitor: 'Dan', plate: 'UVW321', permit: 'SP-1041',   from: '2:00 PM',  until: '8:00 PM' },
  { id: 'V09', status: ADMIN_STATUS.RESERVED,  unit: '5',   visitor: null,  plate: null,     permit: 'SP-1044',   from: '4:00 PM',  until: '7:00 PM' },
  { id: 'V10', status: ADMIN_STATUS.AVAILABLE, unit: null,  visitor: null,  plate: null,     permit: null,        from: null,       until: null },
  { id: 'V11', status: ADMIN_STATUS.AVAILABLE, unit: null,  visitor: null,  plate: null,     permit: null,        from: null,       until: null },
  { id: 'V12', status: ADMIN_STATUS.ACTIVE,    unit: '33',  visitor: 'Priya', plate: 'XYZ111', permit: 'SP-1045', from: '1:30 PM', until: '9:00 PM' },
];

export const INITIAL_VEHICLE_QUEUE = [
  {
    id:           'VR-001',
    plate:        'XYZ999',
    space:        'V11',
    firstSeen:    'Today, 10:14 AM',
    lastSeen:     'Today, 10:14 AM',
    observations: 3,
    permitMatch:  'None',
    residentMatch:'None',
    tempMatch:    'None',
    history: [
      { date: 'Aug 26', time: '9:15 AM' },
      { date: 'Aug 27', time: '7:42 PM' },
      { date: 'Aug 29', time: '8:10 AM' },
    ],
    status:       'pending',   // pending | recognized | unapproved | resolved
    prevDecision: null,
  },
];

export const INITIAL_WAITLIST = [
  { id: 'WL-102', unit: '18', from: '3:30 PM', until: '6:00 PM', status: 'Waiting' },
  { id: 'WL-103', unit: '31', from: '6:00 PM', until: '9:00 PM', status: 'Waiting' },
];

export const INITIAL_ACTIVITY = [
  { ts: '2:00 PM',  text: 'Permit SP-1042 created for Unit 24 visitor.',         source: 'SpotOn' },
  { ts: '3:10 PM',  text: "Visitor permit SP-1042 released early by resident.",   source: 'Resident' },
  { ts: '3:10 PM',  text: 'Waitlisted request re-evaluated after early release.', source: 'SpotOn' },
  { ts: '3:11 PM',  text: 'V07 reallocated to next eligible waitlisted request.', source: 'SpotOn' },
  { ts: '4:15 PM',  text: 'No-show reservation released after grace period.',     source: 'SpotOn' },
  { ts: '4:15 PM',  text: 'Waitlist checked automatically — no compatible match.', source: 'SpotOn' },
  { ts: '10:14 AM', text: 'XYZ999 could not be matched — added to vehicle review queue.', source: 'SpotOn' },
];

export const POLICIES = {
  noshow:    'Reservations are held for 15 minutes after the scheduled start time. After the grace period, SpotOn releases unused capacity and checks the waitlist.',
  extension: 'Extensions are permitted up to 2 hours if the space is not committed to another reservation.',
  visitor:   'Each unit may have up to 2 concurrent active visitor permits. Visitor parking is limited to 24 hours per visit.',
  temp:      'Temporary resident parking is available for up to 8 hours per request, subject to availability.',
};

export const INITIAL_ADMIN_MESSAGES = [
  {
    id: 1,
    role: 'agent',
    text: "Hello. I'm monitoring Maple Grove Townhomes. Currently 7 of 12 visitor spaces are allocated, there are 2 waitlisted requests, and 1 vehicle requires your review. How can I help?",
    ts: '10:15 AM',
  },
];
