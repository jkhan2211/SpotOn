// ─── Resident identity ─────────────────────────────────────────────────────────
// For the hackathon prototype, resident identity is resolved from a unit number
// the resident gives SpotOn in chat (see identify_resident() on the backend) —
// this is NOT authentication, just a lightweight identity/personalization layer.
// This placeholder is only what's shown before that resolves for the session.
export const UNRESOLVED_RESIDENT = {
  unit: null,
  name: null,
};

// ─── Parking space statuses ───────────────────────────────────────────────────
export const STATUS = {
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  ACTIVE: 'active',
  OFFERED: 'offered',  // held for a waitlisted resident who hasn't accepted yet
  UNKNOWN: 'unknown',  // space occupied by unrecognized vehicle — shown as not in service
};

// ─── Initial parking spaces ───────────────────────────────────────────────────
// ownerUnit: null means it belongs to another resident (privacy: show no details)
// ownerUnit: CURRENT_RESIDENT.unit means current user owns it
export const INITIAL_SPACES = [
  { id: 'V01', status: STATUS.AVAILABLE,  ownerUnit: null, visitor: null, permit: null, until: null },
  { id: 'V02', status: STATUS.ACTIVE,     ownerUnit: null, visitor: null, permit: null, until: '6:00 PM' },
  { id: 'V03', status: STATUS.RESERVED,   ownerUnit: null, visitor: null, permit: null, until: '4:00 PM' },
  { id: 'V04', status: STATUS.AVAILABLE,  ownerUnit: null, visitor: null, permit: null, until: null },
  { id: 'V05', status: STATUS.ACTIVE,     ownerUnit: null, visitor: null, permit: null, until: '5:30 PM' },
  { id: 'V06', status: STATUS.RESERVED,   ownerUnit: null, visitor: null, permit: null, until: '7:00 PM' },
  { id: 'V07', status: STATUS.AVAILABLE,  ownerUnit: null, visitor: null, permit: null, until: null },
  { id: 'V08', status: STATUS.ACTIVE,     ownerUnit: null, visitor: null, permit: null, until: '8:00 PM' },
  { id: 'V09', status: STATUS.RESERVED,   ownerUnit: null, visitor: null, permit: null, until: '5:00 PM' },
  { id: 'V10', status: STATUS.AVAILABLE,  ownerUnit: null, visitor: null, permit: null, until: null },
  { id: 'V11', status: STATUS.UNKNOWN,    ownerUnit: null, visitor: null, permit: null, until: null },
  { id: 'V12', status: STATUS.AVAILABLE,  ownerUnit: null, visitor: null, permit: null, until: null },
];

// ─── Scenario step definitions ────────────────────────────────────────────────
export const SCENARIO = {
  IDLE:               'IDLE',
  BOOKING_START:      'BOOKING_START',
  BOOKING_PLATE:      'BOOKING_PLATE',
  BOOKING_CHECKING:   'BOOKING_CHECKING',
  BOOKING_CONFIRMED:  'BOOKING_CONFIRMED',
  FULL_WAITLIST:      'FULL_WAITLIST',
  WAITLISTED:         'WAITLISTED',
  EARLY_RELEASE:      'EARLY_RELEASE',
  REALLOCATION:       'REALLOCATION',
  EXTENSION_REQUEST:  'EXTENSION_REQUEST',
  EXTENSION_CONFLICT: 'EXTENSION_CONFLICT',
  EXTENSION_DONE:     'EXTENSION_DONE',
  NOSHOW_REMINDER:    'NOSHOW_REMINDER',
  GRACE_PERIOD:       'GRACE_PERIOD',
  ALT_TIME:           'ALT_TIME',
  TEMP_PARKING:       'TEMP_PARKING',
  TEMP_CONFIRMED:     'TEMP_CONFIRMED',
};

// ─── Initial chat messages ────────────────────────────────────────────────────
export const INITIAL_MESSAGES = [
  {
    id: 1,
    role: 'agent',
    text: "Hi! I'm your SpotOn Agent for Maple Grove Townhomes. 🅿️\n\nBefore we get started, what unit are you in?",
    ts: '2:01 PM',
  },
];
