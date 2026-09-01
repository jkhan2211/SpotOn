// ─── Admin mock data ──────────────────────────────────────────────────────────
// Space status values match the REAL backend vocabulary exactly (see
// src/resident/residentData.js STATUS) — the admin site plan now fetches real
// /api/parking-spaces data, same as the Resident Portal, so labels/statuses must
// line up. "unknown" is the one status admin and resident deliberately show
// differently (Unauthorized vs Unavailable) — see AdminSitePlan.js STATUS_META.
export const ADMIN_STATUS = {
  AVAILABLE: 'available',
  RESERVED:  'reserved',
  ACTIVE:    'active',
  OFFERED:   'offered',
  UNKNOWN:   'unknown',
};

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
    text: "Hi! I'm your SpotOn Agent for Maple Grove Townhomes. 🅿️\n\nDo you have a licence plate to report today? I'll check it against resident vehicles, visitor permits, and temporary resident permits on file.",
    ts: '10:15 AM',
  },
];
