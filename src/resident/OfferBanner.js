import './OfferBanner.css';

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
};

function OfferRow({ offer, onAccept, onDecline, isBusy }) {
  return (
    <div className="offer-row" role="alert">
      <span className="offer-row__icon" aria-hidden="true">🅿️</span>
      <div className="offer-row__body">
        <strong>Space {offer.space_id} is available</strong> for {offer.visitor_name}
        {offer.visitor_plate ? ` (${offer.visitor_plate})` : ''} · {formatTime(offer.start_time)} – {formatTime(offer.end_time)}
      </div>
      <div className="offer-row__actions">
        <button
          className="offer-row__btn offer-row__btn--accept"
          onClick={() => onAccept(offer.waitlist_id)}
          disabled={isBusy}
          aria-label={`Accept the offered space ${offer.space_id}`}
        >
          {isBusy ? 'Working…' : 'Accept'}
        </button>
        <button
          className="offer-row__btn offer-row__btn--decline"
          onClick={() => onDecline(offer.waitlist_id)}
          disabled={isBusy}
          aria-label={`Decline the offered space ${offer.space_id}`}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

export default function OfferBanner({ offers, onAccept, onDecline, offerActionId }) {
  if (!offers || offers.length === 0) return null;
  return (
    <div className="offer-banner" aria-label="Available parking offers">
      {offers.map(offer => (
        <OfferRow
          key={offer.waitlist_id}
          offer={offer}
          onAccept={onAccept}
          onDecline={onDecline}
          isBusy={offerActionId === offer.waitlist_id}
        />
      ))}
    </div>
  );
}
