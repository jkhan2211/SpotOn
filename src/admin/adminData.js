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

export const INITIAL_ADMIN_MESSAGES = [
  {
    id: 1,
    role: 'agent',
    text: "Hi! I'm your SpotOn Agent for Maple Grove Townhomes. 🅿️\n\nDo you have a licence plate to report today? I'll check it against resident vehicles, visitor permits, and temporary resident permits on file.",
    ts: '10:15 AM',
  },
];
