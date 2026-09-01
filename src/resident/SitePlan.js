import { useState } from 'react';
import { STATUS } from './residentData';
import './SitePlan.css';

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};

// Space objects carry their own permit from the backend now (see /api/parking-spaces) —
// that's the reliable source. activePermits (locally-tracked, keyed by space id) only
// still matters for the deferred, fully-scripted temp-parking demo path, which never
// touches the real backend and so has no CSV-backed permit to report.
const normalizePermit = (p) => {
  if (!p) return null;
  if (p.permit_id !== undefined) {
    return {
      visitor: p.visitor_name,
      plate: p.visitor_plate,
      permitId: p.permit_id,
      from: formatTime(p.start_time),
      until: formatTime(p.end_time),
    };
  }
  return p;
};

const STATUS_META = {
  [STATUS.AVAILABLE]: { label: 'Available',     icon: '✓', mod: 'available' },
  [STATUS.RESERVED]:  { label: 'Reserved',      icon: '●', mod: 'reserved'  },
  [STATUS.ACTIVE]:    { label: 'Occupied',       icon: '●', mod: 'active'    },
  [STATUS.OFFERED]:   { label: 'Offered',        icon: '⏳', mod: 'offered'  },
  [STATUS.UNKNOWN]:   { label: 'Not in Service', icon: '✕', mod: 'unknown'  },
};

// ─── Single parking stall ─────────────────────────────────────────────────────
function ParkingStall({ space, isSelected, onSelect }) {
  const meta  = STATUS_META[space.status] ?? STATUS_META[STATUS.AVAILABLE];
  const isOwn = space.ownerUnit === '14';
  const isUnknown = space.status === STATUS.UNKNOWN;
  return (
    <button
      className={`stall stall--${meta.mod}${isSelected ? ' stall--selected' : ''}`}
      onClick={() => !isUnknown && onSelect(isSelected ? null : space)}
      disabled={isUnknown}
      aria-label={`Space ${space.id}: ${meta.label}`}
      aria-pressed={isSelected}
    >
      <span className="stall__id">{space.id}</span>
      <span className="stall__icon" aria-hidden="true">{meta.icon}</span>
      <span className="stall__label">
        {space.status === STATUS.ACTIVE && isOwn ? 'Mine' : meta.label}
      </span>
    </button>
  );
}

// ─── Parking bay — horizontal row of stalls with a tarmac surround ────────────
function ParkingBay({ spaceIds, spaces, selectedSpace, onSelect, direction = 'row' }) {
  const baySpaces = spaceIds.map(id => spaces.find(s => s.id === id)).filter(Boolean);
  return (
    <div className={`parking-bay parking-bay--${direction}`} aria-label="Visitor parking">
      <div className="parking-bay__tag">P</div>
      <div className="parking-bay__stalls">
        {baySpaces.map(s => (
          <ParkingStall
            key={s.id}
            space={s}
            isSelected={selectedSpace?.id === s.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Townhome block with optional inline parking bay ─────────────────────────
// parkingBay: { spaceIds, side: 'left'|'right'|'bottom' }
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
    <ParkingBay
      spaceIds={parkingBay.spaceIds}
      spaces={spaces}
      selectedSpace={selectedSpace}
      onSelect={onSelect}
      direction={parkingBay.direction || 'row'}
    />
  ) : null;

  return (
    <div className="th-block">
      <div className="th-block__label">{label}</div>
      <div className={`th-block__inner${parkingBay?.side === 'right' ? ' th-block__inner--right' : parkingBay?.side === 'left' ? ' th-block__inner--left' : ''}`}>
        {parkingBay?.side === 'left' && bay}
        <div className="th-block__units">{unitEls}</div>
        {parkingBay?.side === 'right' && bay}
      </div>
      {parkingBay?.side === 'bottom' && (
        <div className="th-block__bottom-bay">{bay}</div>
      )}
    </div>
  );
}

// ─── Internal lane ────────────────────────────────────────────────────────────
function InternalLane({ name }) {
  return (
    <div className="lane" role="separator" aria-label={`Internal road: ${name}`}>
      <div className="lane__marking" aria-hidden="true" />
      <span className="lane__name">{name}</span>
      <div className="lane__marking" aria-hidden="true" />
    </div>
  );
}

// ─── Landscape strip ──────────────────────────────────────────────────────────
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

// ─── Space popover ────────────────────────────────────────────────────────────
function SpacePopover({ space, activePermit, onRelease, isReleasing, onClose }) {
  if (!space) return null;
  const meta = STATUS_META[space.status];
  const permit = normalizePermit(space.permit) ?? activePermit;
  return (
    <div className="space-popover" role="dialog" aria-label={`Details for ${space.id}`}>
      <div className="space-popover__header">
        <span className="space-popover__id">{space.id}</span>
        <button className="space-popover__close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <span className={`space-popover__badge space-popover__badge--${space.status}`}>
        {meta.icon} {meta.label}
      </span>
      {permit ? (
        <>
          <dl className="space-popover__dl">
            <dt>Visitor</dt><dd>{permit.visitor}</dd>
            <dt>Plate</dt>  <dd>{permit.plate}</dd>
            <dt>Permit</dt> <dd>{permit.permitId}</dd>
            <dt>From</dt>   <dd>{permit.from}</dd>
            <dt>Until</dt>  <dd>{permit.until}</dd>
          </dl>
          <button className="space-popover__release" onClick={onRelease} disabled={isReleasing}>
            {isReleasing ? 'Releasing…' : '🔓 Release Early'}
          </button>
        </>
      ) : space.status === STATUS.OFFERED ? (
        <p className="space-popover__note">This space is being held for a waitlisted resident.</p>
      ) : space.status !== STATUS.AVAILABLE ? (
        <p className="space-popover__note">Space details are private.</p>
      ) : (
        <p className="space-popover__note">This space is available.</p>
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

// ─── Capacity bar ─────────────────────────────────────────────────────────────
function CapacityBar({ spaces }) {
  const total     = spaces.filter(s => s.status !== STATUS.UNKNOWN).length;
  const available = spaces.filter(s => s.status === STATUS.AVAILABLE).length;
  const pct       = Math.round((available / total) * 100);
  return (
    <div className="capacity-bar">
      <div className="capacity-bar__row">
        <span className="capacity-bar__title">Visitor Parking</span>
        <span className="capacity-bar__count">
          <strong>{available}</strong> of {total} spaces available
        </span>
      </div>
      <div className="capacity-bar__track"
        role="progressbar" aria-valuenow={available} aria-valuemin={0} aria-valuemax={total}
        aria-label={`${available} of ${total} visitor spaces available`}>
        <div className="capacity-bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Main SitePlan ────────────────────────────────────────────────────────────
export default function SitePlan({ spaces, selectedSpace, onSelectSpace, activePermits, onRelease, isReleasing }) {
  const [localSelected, setLocalSelected] = useState(null);
  const activeId = (selectedSpace ?? localSelected)?.id;
  const active = spaces.find(s => s.id === activeId) ?? null;
  const activePermit = active ? (activePermits[active.id] ?? null) : null;

  const handleSelect = (space) => {
    setLocalSelected(space);
    onSelectSpace(space);
  };

  return (
    <div className="siteplan">
      <div className="siteplan__header">
        <div>
          <h2 className="siteplan__title">Maple Grove Townhomes</h2>
          <p className="siteplan__subtitle">Demo Community · Site Plan</p>
        </div>
        <Legend />
      </div>

      <CapacityBar spaces={spaces} />

      <div className="community-plan" aria-label="Maple Grove Townhomes community site plan">

        {/* North perimeter */}
        <LandscapeEdge label="Maple Grove Drive" trees={4} />
        <div className="sidewalk" aria-hidden="true" />

        {/* ── ROW A ─────────────────────────────────────────────────────────
            Block A (units 1–6) with visitor bay V01–V02 on its right end
            Block B (units 7–12) with visitor bay V03–V04 on its left end
            Gap between blocks has a small landscaped island
        ──────────────────────────────────────────────────────────────────── */}
        <div className="block-row">
          <TownhomeBlock
            label="Block A · Units 1–6"
            units={[1,2,3,4,5,6]}
            parkingBay={{ spaceIds: ['V01','V02'], side: 'right' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect}
          />
          <div className="block-row__island" aria-hidden="true">
            <span className="tree">🌳</span>
            <span className="tree">🌲</span>
          </div>
          <TownhomeBlock
            label="Block B · Units 7–12"
            units={[7,8,9,10,11,12]}
            parkingBay={{ spaceIds: ['V03','V04'], side: 'left' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect}
          />
        </div>

        {/* Driveways Row A */}
        <div className="driveway-row" aria-hidden="true">
          <div className="driveway-cells">
            {Array.from({length: 12}, (_,i) => <div key={i} className="driveway-cell" />)}
          </div>
        </div>

        {/* ── LANE A ── */}
        <InternalLane name="Maple Lane" />

        {/* ── ROW B ─────────────────────────────────────────────────────────
            Block C (units 13–18) with visitor bay V05–V06 below it
            Block D (units 19–24) with visitor bay V07–V08 below it
        ──────────────────────────────────────────────────────────────────── */}
        <div className="block-row block-row--lane-side">
          <TownhomeBlock
            label="Block C · Units 13–18"
            units={[13,14,15,16,17,18]}
            parkingBay={{ spaceIds: ['V05','V06'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect}
            flip
          />
          <div className="block-row__island" aria-hidden="true">
            <span className="tree">🌲</span>
            <span className="tree">🌳</span>
          </div>
          <TownhomeBlock
            label="Block D · Units 19–24"
            units={[19,20,21,22,23,24]}
            parkingBay={{ spaceIds: ['V07','V08'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect}
            flip
          />
        </div>

        {/* ── LANE B ── */}
        <InternalLane name="Grove Court" />

        {/* ── ROW C ─────────────────────────────────────────────────────────
            Block E (units 25–30) with visitor bay V09–V10 above (lane side)
            Block F (units 31–36) with visitor bay V11–V12 above (lane side)
        ──────────────────────────────────────────────────────────────────── */}
        <div className="block-row block-row--lane-side">
          <TownhomeBlock
            label="Block E · Units 25–30"
            units={[25,26,27,28,29,30]}
            parkingBay={{ spaceIds: ['V09','V10'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect}
          />
          <div className="block-row__island" aria-hidden="true">
            <span className="tree">🌳</span>
            <span className="tree">🌲</span>
          </div>
          <TownhomeBlock
            label="Block F · Units 31–36"
            units={[31,32,33,34,35,36]}
            parkingBay={{ spaceIds: ['V11','V12'], side: 'bottom' }}
            spaces={spaces} selectedSpace={active} onSelect={handleSelect}
          />
        </div>

        {/* Driveways Row C */}
        <div className="driveway-row" aria-hidden="true">
          <div className="driveway-cells">
            {Array.from({length: 12}, (_,i) => <div key={i} className="driveway-cell" />)}
          </div>
        </div>

        {/* South perimeter */}
        <div className="sidewalk" aria-hidden="true" />
        <LandscapeEdge trees={4} />

        <div className="entry-label" aria-label="Main entrance">
          ▲ Maple Grove Drive — Main Entrance
        </div>
      </div>

      {active && (
        <SpacePopover
          space={active}
          activePermit={activePermit}
          onRelease={() => onRelease(active.id)}
          isReleasing={isReleasing}
          onClose={() => handleSelect(null)}
        />
      )}

      <p className="siteplan__disclaimer">
        Fictional demo community. All names, units, and data are simulated.
      </p>
    </div>
  );
}
