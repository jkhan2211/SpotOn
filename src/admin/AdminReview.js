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
        <dt>Location</dt>    <dd>{vehicle.space || '—'}</dd>
        <dt>First seen</dt>  <dd>{vehicle.firstSeen}</dd>
        <dt>Last seen</dt>   <dd>{vehicle.lastSeen}</dd>
        <dt>Permit match</dt><dd>{vehicle.permitMatch}</dd>
        <dt>Resident</dt>    <dd>{vehicle.residentMatch}</dd>
        <dt>Temp permit</dt> <dd>{vehicle.tempMatch}</dd>
      </dl>

      {vehicle.observations >= 2 && (
        <div className="vr-card__history">
          <span className="vr-card__history-label">Observation history</span>
          <ul className="vr-card__history-list">
            {vehicle.history.map((h, i) => (
              <li key={i}>{h.date} · {h.time}</li>
            ))}
          </ul>
        </div>
      )}

      {vehicle.prevDecision && (
        <div className="vr-card__prev">
          <span className="vr-card__prev-label">Previous decision</span>
          <span>{vehicle.prevDecision.decision} · {vehicle.prevDecision.date}</span>
        </div>
      )}

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
  const pending = vehicles.filter(v => v.status === 'pending').length;
  return (
    <section className="review-section" aria-label="Vehicles requiring review">
      <div className="review-section__header">
        <h2 className="review-section__title">
          Vehicles Requiring Review
          {pending > 0 && <span className="review-section__badge">{pending}</span>}
        </h2>
        <p className="review-section__sub">
          SpotOn surfaces vehicles with no matching permit or resident record. You retain authority over all decisions.
        </p>
      </div>
      {vehicles.length === 0 ? (
        <p className="review-section__empty">No vehicles currently require review.</p>
      ) : (
        <div className="review-section__cards">
          {vehicles.map(v => (
            <VehicleCard key={v.id} vehicle={v} onResolve={onResolve} />
          ))}
        </div>
      )}
    </section>
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
