import './Features.css';

const features = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: 'Smart Visitor Permits',
    description:
      'Residents can request visitor parking naturally while SpotOn checks availability and community parking rules — no manual back-and-forth required.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
    title: 'Intelligent Space Reallocation',
    description:
      'When plans change or parking is released early, SpotOn reconsiders waitlisted requests and makes shared capacity available to another resident automatically.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    title: 'Unknown Vehicle Review',
    description:
      'SpotOn checks reported vehicles against resident and parking records before surfacing only unmatched vehicles to administrators for review.',
  },
];

export default function Features() {
  return (
    <section className="features" aria-labelledby="features-heading">
      <div className="features__inner">
        <h2 className="features__heading" id="features-heading">
          Everything your community needs
        </h2>
        <p className="features__subheading">
          SpotOn handles the routine so your team handles the exceptional.
        </p>
        <ul className="features__grid" role="list">
          {features.map((f) => (
            <li key={f.title} className="feature-card">
              <div className="feature-card__icon" aria-hidden="true">
                {f.icon}
              </div>
              <h3 className="feature-card__title">{f.title}</h3>
              <p className="feature-card__description">{f.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
