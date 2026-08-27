import { useState } from 'react';
import { ADMIN_STATUS } from './adminData';
import './AdminSitePlan.css';

const STATUS_META = {
  [ADMIN_STATUS.AVAILABLE]: { label: 'Available',  icon: '✓',  mod: 'available' },
  [ADMIN_STATUS.RESERVED]:  { label: 'Reserved',   icon: '⏱', mod: 'reserved'  },
  [ADMIN_STATUS.ACTIVE]:    { label: 'Active',      icon: '●',  mod: 'active'    },
  [ADMIN_STATUS.TEMP]:      { label: 'Temporary',   icon: '🔧', mod: 'temp'      },
  [ADMIN_STATUS.REVIEW]:    { label: 'Review Req.', icon: '⚠',  mod: 'review'    },
};

// ─── Admin parking stall — shows full details on click ────────────────────────
function AdminStall({ space, isSelected, onSelect }) {
  const meta = STATUS_META[space.status] ?? STATUS_META[ADMIN_STATUS.AVAILABLE];
  return (
    <button
      className={`stall stall--${meta.mod}${isSelected ? ' stall--selected' : ''}`}
      onClick={() => onSelect(isSelected ? null : space)}
      aria-label={`Space ${space.id}: ${meta.label}${space.plate ? `, plate ${space.plate}` : ''}`}
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
function AdminSpacePopover({ space, onClose }) {
  if (!space) return null;
  const meta = STATUS_META[space.status] ?? STATUS_META[ADMIN_STATUS.AVAILABLE];
  const isReview = space.status === ADMIN_STATUS.REVIEW;
  return (
    <div className="space-popover" role="dialog" aria-label={`Admin details for ${space.id}`}>
      <div className="space-popover__header">
        <span className="space-popover__id">{space.id}</span>
        <button className="space-popover__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <span className={`space-popover__badge space-popover__badge--${space.status}`}>
        {meta.icon} {meta.label}
      </span>
      {isReview ? (
        <dl className="space-popover__dl">
          <dt>Plate</dt>    <dd className="space-popover__warn">{space.plate}</dd>
          <dt>Permit</dt>   <dd>None</dd>
          <dt>Resident</dt> <dd>No match</dd>
        </dl>
      ) : space.status === ADMIN_STATUS.AVAILABLE ? (
        <p className="space-popover__note">Space is available.</p>
      ) : (
        <dl className="space-popover__dl">
          {space.unit    && <><dt>Unit</dt>    <dd>{space.unit}</dd></>}
          {space.visitor && <><dt>Visitor</dt> <dd>{space.visitor}</dd></>}
          {space.plate   && <><dt>Plate</dt>   <dd>{space.plate}</dd></>}
          {space.permit  && <><dt>Permit</dt>  <dd>{space.permit}</dd></>}
          {space.from    && <><dt>From</dt>    <dd>{space.from}</dd></>}
          {space.until   && <><dt>Until</dt>   <dd>{space.until}</dd></>}
        </dl>
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
export default function AdminSitePlan({ spaces, selectedSpace, onSelectSpace, waitlistCount = 0, reviewCount = 0 }) {
  const [localSelected, setLocalSelected] = useState(null);
  const active = selectedSpace ?? localSelected;

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

      {active && <AdminSpacePopover space={active} onClose={() => handleSelect(null)} />}

      <p className="siteplan__disclaimer">Fictional demo community. All data is simulated.</p>
    </div>
  );
}
