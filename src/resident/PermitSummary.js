import './PermitSummary.css';

function PermitCard({ permit, onExtend, onRelease }) {
  const isTemp = permit.type === 'temp';
  return (
    <div className={`permit-card${isTemp ? ' permit-card--temp' : ''}`}>
      <div className="permit-card__header">
        <span className="permit-card__visitor">{permit.visitor}</span>
        <span className={`permit-card__badge permit-card__badge--${permit.status?.toLowerCase()}`}>
          {isTemp ? '🔧 Temp' : permit.status}
        </span>
      </div>
      <div className="permit-card__meta">
        <span className="permit-card__space">{permit.space}</span>
        <span className="permit-card__time">{permit.from} → {permit.until}</span>
      </div>
      {permit.plate && permit.plate !== '—' && (
        <div className="permit-card__plate">{permit.plate}</div>
      )}
      <div className="permit-card__actions">
        {onExtend && (
          <button className="permit-action permit-action--extend" onClick={onExtend} aria-label={`Extend ${permit.visitor}'s permit`}>
            Extend
          </button>
        )}
        {onRelease && (
          <button className="permit-action permit-action--release" onClick={onRelease} aria-label={`Release ${permit.visitor}'s permit early`}>
            Release Early
          </button>
        )}
      </div>
    </div>
  );
}

function WaitlistCard({ item }) {
  return (
    <div className="permit-card permit-card--waitlist">
      <div className="permit-card__header">
        <span className="permit-card__visitor">{item.visitor}</span>
        <span className="permit-card__badge permit-card__badge--waiting">⏳ Waiting</span>
      </div>
      <div className="permit-card__meta">
        <span className="permit-card__time">{item.from} → {item.until}</span>
      </div>
      <p className="permit-card__note">Waiting for availability</p>
    </div>
  );
}

export default function PermitSummary({ activePermit, waitlistItem, onExtend, onRelease }) {
  if (!activePermit && !waitlistItem) return null;

  return (
    <section className="permit-summary" aria-label="Your parking summary">
      <h2 className="permit-summary__heading">Your Parking</h2>
      <div className="permit-summary__cards">
        {activePermit && (
          <PermitCard
            permit={activePermit}
            onExtend={activePermit.status !== 'Active' ? undefined : onExtend}
            onRelease={onRelease}
          />
        )}
        {waitlistItem && <WaitlistCard item={waitlistItem} />}
      </div>
    </section>
  );
}
