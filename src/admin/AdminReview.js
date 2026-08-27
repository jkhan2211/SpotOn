import './AdminReview.css';

const STATUS_LABELS = {
  pending:    { label: 'Pending Review', mod: 'pending'    },
  recognized: { label: 'Recognized',    mod: 'recognized' },
  unapproved: { label: 'Unapproved',    mod: 'unapproved' },
  resolved:   { label: 'Resolved',      mod: 'resolved'   },
};

function VehicleCard({ vehicle, onResolve }) {
  const st     = STATUS_LABELS[vehicle.status] ?? STATUS_LABELS.pending;
  const isPending = vehicle.status === 'pending';
  return (
    <div className={`vr-card vr-card--${st.mod}`} aria-label={`Vehicle review: ${vehicle.plate}`}>
      <div className="vr-card__header">
        <div className="vr-card__plate-row">
          <span className="vr-card__icon" aria-hidden="true">⚠</span>
          <span className="vr-card__plate">{vehicle.plate}</span>
          {vehicle.observations >= 2 && (
            <span className="vr-card__repeat-badge" aria-label="Repeated observation">
              Repeated · {vehicle.observations}×
            </span>
          )}
        </div>
        <span className={`vr-card__status vr-card__status--${st.mod}`}>{st.label}</span>
      </div>

      <dl className="vr-card__dl">
        <dt>Space</dt>  <dd>{vehicle.space || '—'}</dd>
        <dt>Seen</dt>   <dd>{vehicle.firstSeen}</dd>
        <dt>Permit</dt> <dd>{vehicle.permitMatch}</dd>
      </dl>

      {isPending && (
        <div className="vr-card__actions">
          <button
            className="vr-btn vr-btn--recognize"
            onClick={() => onResolve(vehicle.id, 'recognized')}
            aria-label={`Mark ${vehicle.plate} as recognized`}
          >
            ✓ Mark Recognized
          </button>
          <button
            className="vr-btn vr-btn--unapprove"
            onClick={() => onResolve(vehicle.id, 'unapproved')}
            aria-label={`Keep ${vehicle.plate} as unapproved`}
          >
            ✕ Keep Unapproved
          </button>
        </div>
      )}
    </div>
  );
}

export function VehicleReviewQueue({ vehicles, onResolve }) {
  const pending = vehicles.filter(v => v.status === 'pending');
  if (pending.length === 0) return null;
  return (
    <div className="vr-banners" aria-label="Vehicles requiring review">
      {pending.map(v => (
        <div key={v.id} className="vr-banner" role="alert">
          <span className="vr-banner__icon" aria-hidden="true">⚠</span>
          <div className="vr-banner__body">
            <span className="vr-banner__plate">{v.plate}</span>
            <span className="vr-banner__meta">Space {v.space} · No permit match</span>
          </div>
          <div className="vr-banner__actions">
            <button className="vr-banner__btn vr-banner__btn--approve"
              onClick={() => onResolve(v.id, 'recognized')}
              aria-label={`Mark ${v.plate} recognized`}>✓ Recognize</button>
            <button className="vr-banner__btn vr-banner__btn--deny"
              onClick={() => onResolve(v.id, 'unapproved')}
              aria-label={`Keep ${v.plate} unapproved`}>✕ Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityFeed({ activity }) {
  return (
    <section className="activity-feed" aria-label="Recent SpotOn activity">
      <h2 className="activity-feed__title">Recent Activity</h2>
      <ol className="activity-feed__list" reversed>
        {activity.slice(0, 8).map((a, i) => (
          <li key={i} className="activity-item">
            <span className="activity-item__ts">{a.ts}</span>
            <span className="activity-item__source activity-item__source--spoton">{a.source}</span>
            <span className="activity-item__text">{a.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
