import './Positioning.css';

export default function Positioning() {
  return (
    <section className="positioning" aria-labelledby="positioning-heading">
      <div className="positioning__inner">
        <div className="positioning__icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h2 className="positioning__heading" id="positioning-heading">
          Parking coordination without the coordination.
        </h2>
        <p className="positioning__body">
          SpotOn handles routine parking operations automatically and surfaces
          only the situations that actually need human attention.
        </p>
      </div>
    </section>
  );
}
