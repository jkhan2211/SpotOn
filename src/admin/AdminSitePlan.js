import { useState } from 'react';
import { ADMIN_STATUS } from './adminData';
import './AdminSitePlan.css';

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};

// Mirrors resident/SitePlan.js's normalizePermit — same real backend permit shape.
const normalizePermit = (p) => {
  if (!p) return null;
  return {
    visitor: p.visitor_name,
    plate: p.visitor_plate,
    permitId: p.permit_id,
    permitType: p.permit_type,
    from: formatTime(p.start_time),
    until: formatTime(p.end_time),
  };
};

// Same statuses as the Resident Portal (real backend data) — "unknown" is the one
// case admin and resident are deliberately shown differently: a resident just needs
// to know the space isn't usable ("Unavailable"), while admin needs to know WHY
// ("Unauthorized" — a human-reported vehicle that didn't match any record).
const STATUS_META = {
  [ADMIN_STATUS.AVAILABLE]: { label: 'Available',    icon: '✓', mod: 'available' },
  [ADMIN_STATUS.RESERVED]:  { label: 'Reserved',      icon: '●', mod: 'reserved'  },
  [ADMIN_STATUS.ACTIVE]:    { label: 'Occupied',      icon: '●', mod: 'active'    },
  [ADMIN_STATUS.OFFERED]:   { label: 'Offered',       icon: '⏳', mod: 'offered'  },
  [ADMIN_STATUS.UNKNOWN]:   { label: 'Unauthorized',  icon: '⚠', mod: 'unknown'  },
};

// ─── Admin parking stall — shows full details on click ────────────────────────
function AdminStall({ space, isSelected, onSelect }) {
  const meta = STATUS_META[space.status] ?? STATUS_META[ADMIN_STATUS.AVAILABLE];
  return (
    <button
      className={`stall stall--${meta.mod}${isSelected ? ' stall--selected' : ''}`}
      onClick={() => onSelect(isSelected ? null : space)}
      aria-label={`Space ${space.id}: ${meta.label}`}
      aria-pressed={isSelected}
    >
      <span className="stall__id">{space.id}</span>
      <span className="stall__icon" aria-hidden="true">{meta.icon}</span>
      <span className="stall__label">{meta.label}</span>
    </button>
  );
}

// ─── Parking bay ──────────────────────────────────────────────────────────────
function ParkingBay({ spaceIds, spaces, selectedSpace, onSelect }) {
  const baySpaces = spaceIds.map(id => spaces.find(s => s.id === id)).filter(Boolean);
  return (
    <div className="parking-bay" aria-label="Visitor parking">
      <div className="parking-bay__tag">P</div>
      <div className="parking-bay__stalls">
        {baySpaces.map(s => (
          <AdminStall key={s.id} space={s} isSelected={selectedSpace?.id === s.id} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

// ─── Townhome block ───────────────────────────────────────────────────────────
function TownhomeBlock({ label, units, parkingBay, spaces, selectedSpace, onSelect, flip = false }) {
  const unitEls = units.map(u => (
    <div key={u} className={`th-unit${flip ? ' th-unit--flip' : ''}`}>
      <div className="th-unit__roof"   aria-hidden="true" />
      <div className="th-unit__body">
        <div className="th-unit__window" aria-hidden="true" />
        <div className="th-unit__door"   aria-hidden="true" />
      </div>
      <div className="th-unit__num">{u}</div>
      <div className="th-unit__drive"  aria-hidden="true" />
    </div>
  ));
  const bay = parkingBay ? (
    <ParkingBay spaceIds={parkingBay.spaceIds} spaces={spaces} selectedSpace={selectedSpace} onSelect={onSelect} />
  ) : null;
  return (
    <div className="th-block">
      <div className="th-block__label">{label}</div>
      <div className={`th-block__inner${parkingBay?.side === 'right' ? ' th-block__inner--right' : parkingBay?.side === 'left' ? ' th-block__inner--left' : ''}`}>
        {parkingBay?.side === 'left'  && bay}
        <div className="th-block__units">{unitEls}</div>
        {parkingBay?.side === 'right' && bay}
      </div>
      {parkingBay?.side === 'bottom' && <div className="th-block__bottom-bay">{bay}</div>}
    </div>
  );
}

function InternalLane({ name }) {
  return (
    <div className="lane" role="separator" aria-label={`Internal road: ${name}`}>
      <div className="lane__marking" aria-hidden="true" />
      <span className="lane__name">{name}</span>
      <div className="lane__marking" aria-hidden="true" />
    </div>
  );
}

function LandscapeEdge({ label, trees = 4 }) {
  return (
    <div className="landscape-edge" aria-label={label || 'Landscaped area'}>
      {Array.from({ length: trees }, (_, i) => (
        <span key={i} className="tree" aria-hidden="true">{i % 2 === 0 ? '🌳' : '🌲'}</span>
      ))}
      {label && <span className="landscape-edge__label">{label}</span>}
      {Array.from({ length: trees }, (_, i) => (
        <span key={`b${i}`} className="tree" aria-hidden="true">{i % 2 === 0 ? '🌲' : '🌳'}</span>
      ))}
    </div>
  );
}

// ─── Admin popover — full operational detail ──────────────────────────────────
function AdminSpacePopover({ space, vehicleReports, onClose }) {
  if (!space) return null;
  const meta = STATUS_META[space.status] ?? STATUS_META[ADMIN_STATUS.AVAILABLE];
  const isUnknown = space.status === ADMIN_STATUS.UNKNOWN;
  const permit = normalizePermit(space.permit);
  // Admin sees the actual reported plate/reasoning for an unauthorized space — this is
  // the one place resident and admin views genuinely diverge (resident never sees this).
  const report = isUnknown
    ? vehicleReports.find(r => r.space_id === space.id && r.status === 'requires_review')
    : null;

  return (
    <div className="space-popover" role="dialog" aria-label={`Admin details for ${space.id}`}>
      <div className="space-popover__header">
        <span className="space-popover__id">{space.id}</span>
        <button className="space-popover__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <span className={`space-popover__badge space-popover__badge--${space.status}`}>
        {meta.icon} {meta.label}
      </span>
      {isUnknown ? (
        <dl className="space-popover__dl">
          <dt>Plate</dt>     <dd className="space-popover__warn">{report?.plate ?? 'Unknown'}</dd>
          <dt>Resident</dt>  <dd>No match</dd>
          <dt>Visitor</dt>   <dd>No match</dd>
          <dt>Reported</dt>  <dd>{report ? formatTime(report.reported_at) : '—'}</dd>
        </dl>
      ) : permit ? (
        <dl className="space-popover__dl">
          <dt>Visitor</dt><dd>{permit.visitor}</dd>
          <dt>Plate</dt>  <dd>{permit.plate}</dd>
          <dt>Permit</dt> <dd>{permit.permitId}</dd>
          <dt>From</dt>   <dd>{permit.from}</dd>
          <dt>Until</dt>  <dd>{permit.until}</dd>
        </dl>
      ) : space.status === ADMIN_STATUS.OFFERED ? (
        <p className="space-popover__note">This space is being held for a waitlisted resident.</p>
      ) : space.status === ADMIN_STATUS.AVAILABLE ? (
        <p className="space-popover__note">Space is available.</p>
      ) : (
        <p className="space-popover__note">No permit details on file for this space.</p>
      )}
    </div>
  );
}

// ─── Review strip — fixed-height row of flagged spaces below the map ──────────
// A compact chip per space needing review, not a growing card list, so the map's
// share of the column height never changes as reports come and go. Clicking a chip
// opens a centered modal (not an inline popover) — that avoids both problems an
// inline card had here: getting clipped by rp-left's overflow:hidden when there's
// no room below the strip, and covering the map when opened above it. A modal is
// also what makes "stays open until the admin acts" feel intentional rather than
// like a glitch, and gives the reasoning text room to show in full, no truncation.
function ReviewModal({ report, onClose, onMarkExpected, onReportToSecurity, isBusy }) {
  const reasons = (report.reasoning || '').split('|').map(s => s.trim()).filter(Boolean);
  return (
    <div className="review-modal-backdrop" onClick={onClose}>
      <div
        className="review-modal"
        role="dialog"
        aria-label={`Review details for space ${report.space_id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="review-modal__header">
          <span className="review-modal__space">Space {report.space_id}</span>
          <button type="button" className="review-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="review-modal__plate">{report.plate}</div>
        <ul className="review-modal__reasons">
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="review-modal__actions">
          <button
            type="button"
            className="review-modal__btn review-modal__btn--ok"
            onClick={() => onMarkExpected(report.report_id)}
            disabled={isBusy}
          >
            {isBusy ? 'Working…' : '✓ Mark as Expected'}
          </button>
          <button
            type="button"
            className="review-modal__btn review-modal__btn--deny"
            onClick={() => onReportToSecurity(report.report_id)}
            disabled={isBusy}
          >
            {isBusy ? 'Working…' : '✕ Report to Security'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewStrip({ reports, onMarkExpected, onReportToSecurity, actionId }) {
  const [openId, setOpenId] = useState(null);
  const pending = reports.filter(r => r.status === 'requires_review');
  // If the open report resolves (approved/reported) it drops out of `pending` on the
  // next fetch, so this naturally becomes null and the modal closes itself.
  const openReport = pending.find(r => r.report_id === openId) ?? null;
  return (
    <div className="review-strip" aria-label="Spaces needing review">
      <span className="review-strip__label">
        {pending.length > 0 ? `⚠ Needs Review (${pending.length})` : 'No vehicles flagged for review'}
      </span>
      <div className="review-strip__chips">
        {pending.map(r => (
          <button
            key={r.report_id}
            type="button"
            className="review-chip"
            onClick={() => setOpenId(r.report_id)}
            aria-label={`Space ${r.space_id} needs review — plate ${r.plate}`}
          >
            <span aria-hidden="true">⚠</span> {r.space_id}
          </button>
        ))}
      </div>
      {openReport && (
        <ReviewModal
          report={openReport}
          onClose={() => setOpenId(null)}
          onMarkExpected={onMarkExpected}
          onReportToSecurity={onReportToSecurity}
          isBusy={actionId === openReport.report_id}
        />
      )}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div className="sp-legend" role="list" aria-label="Parking status legend">
      {Object.entries(STATUS_META).map(([key, meta]) => (
        <div key={key} className="sp-legend__item" role="listitem">
          <span className={`sp-legend__dot sp-legend__dot--${key}`} aria-hidden="true">{meta.icon}</span>
          <span>{meta.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Capacity summary ─────────────────────────────────────────────────────────
function CapacityBar({ spaces, waitlistCount, reviewCount }) {
  const total     = spaces.length;
  const available = spaces.filter(s => s.status === ADMIN_STATUS.AVAILABLE).length;
  const allocated = total - available;
  const pct       = Math.round((allocated / total) * 100);
  return (
    <div className="admin-capacity">
      <div className="admin-capacity__stats">
        <div className="admin-stat">
          <span className="admin-stat__val">{allocated}<span className="admin-stat__total">/{total}</span></span>
          <span className="admin-stat__label">Allocated</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat__val">{waitlistCount}</span>
          <span className="admin-stat__label">Waitlisted</span>
        </div>
        <div className={`admin-stat${reviewCount > 0 ? ' admin-stat--warn' : ''}`}>
          <span className="admin-stat__val">{reviewCount}</span>
          <span className="admin-stat__label">For Review</span>
        </div>
      </div>
      <div className="capacity-bar__track"
        role="progressbar" aria-valuenow={allocated} aria-valuemin={0} aria-valuemax={total}
        aria-label={`${allocated} of ${total} visitor spaces allocated`}>
        <div className="capacity-bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Main AdminSitePlan ───────────────────────────────────────────────────────
export default function AdminSitePlan({
  spaces, selectedSpace, onSelectSpace, vehicleReports = [], waitlistCount = 0, reviewCount = 0,
  onMarkExpected, onReportToSecurity, reportActionId,
}) {
  const [localSelected, setLocalSelected] = useState(null);
  const activeId = (selectedSpace ?? localSelected)?.id;
  const active = spaces.find(s => s.id === activeId) ?? null;

  const handleSelect = (space) => {
    setLocalSelected(space);
    onSelectSpace(space);
  };

  return (
    <div className="siteplan">
      <div className="siteplan__header">
        <div>
          <h2 className="siteplan__title">Maple Grove Townhomes</h2>
          <p className="siteplan__subtitle">Admin View · Live Parking State</p>
        </div>
        <Legend />
      </div>

      <CapacityBar spaces={spaces} waitlistCount={waitlistCount} reviewCount={reviewCount} />

      <div className="community-plan" aria-label="Admin community site plan">
        <LandscapeEdge label="Maple Grove Drive" trees={4} />
        <div className="sidewalk" aria-hidden="true" />

        <div className="block-row">
          <TownhomeBlock label="Block A · Units 1–6"   units={[1,2,3,4,5,6]}
            parkingBay={{ spaceIds: ['V01','V02'], side: 'right' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect} />
          <div className="block-row__island" aria-hidden="true">
            <span className="tree">🌳</span><span className="tree">🌲</span>
          </div>
          <TownhomeBlock label="Block B · Units 7–12"  units={[7,8,9,10,11,12]}
            parkingBay={{ spaceIds: ['V03','V04'], side: 'left' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect} />
        </div>

        <div className="driveway-row" aria-hidden="true">
          <div className="driveway-cells">
            {Array.from({length:12},(_,i)=><div key={i} className="driveway-cell"/>)}
          </div>
        </div>

        <InternalLane name="Maple Lane" />

        <div className="block-row block-row--lane-side">
          <TownhomeBlock label="Block C · Units 13–18" units={[13,14,15,16,17,18]}
            parkingBay={{ spaceIds: ['V05','V06'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect} flip />
          <div className="block-row__island" aria-hidden="true">
            <span className="tree">🌲</span><span className="tree">🌳</span>
          </div>
          <TownhomeBlock label="Block D · Units 19–24" units={[19,20,21,22,23,24]}
            parkingBay={{ spaceIds: ['V07','V08'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect} flip />
        </div>

        <InternalLane name="Grove Court" />

        <div className="block-row block-row--lane-side">
          <TownhomeBlock label="Block E · Units 25–30" units={[25,26,27,28,29,30]}
            parkingBay={{ spaceIds: ['V09','V10'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect} />
          <div className="block-row__island" aria-hidden="true">
            <span className="tree">🌳</span><span className="tree">🌲</span>
          </div>
          <TownhomeBlock label="Block F · Units 31–36" units={[31,32,33,34,35,36]}
            parkingBay={{ spaceIds: ['V11','V12'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect} />
        </div>

        <div className="driveway-row" aria-hidden="true">
          <div className="driveway-cells">
            {Array.from({length:12},(_,i)=><div key={i} className="driveway-cell"/>)}
          </div>
        </div>

        <div className="sidewalk" aria-hidden="true" />
        <LandscapeEdge trees={4} />
        <div className="entry-label" aria-label="Main entrance">
          ▲ Maple Grove Drive — Main Entrance
        </div>
      </div>

      <ReviewStrip
        reports={vehicleReports}
        onMarkExpected={onMarkExpected}
        onReportToSecurity={onReportToSecurity}
        actionId={reportActionId}
      />

      {active && (
        <AdminSpacePopover
          space={active}
          vehicleReports={vehicleReports}
          onClose={() => handleSelect(null)}
        />
      )}

      <p className="siteplan__disclaimer">Fictional demo community. All data is simulated.</p>
    </div>
  );
}
