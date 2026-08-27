import { Link } from 'react-router-dom';
import logo from '../asset/logo.png';
import './Hero.css';

export default function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero__inner">
        <div className="hero__logo-wrap" aria-hidden="true">
          <img src={logo} alt="SpotOn" className="hero__logo" />
        </div>
        <div className="hero__badge" aria-hidden="true">
          <span className="hero__badge-dot" />
          Autonomous Parking Management
        </div>
        <h1 className="hero__heading" id="hero-heading">
          Autonomous community<br />parking management.
        </h1>
        <p className="hero__description">
          SpotOn helps residential communities coordinate shared parking
          automatically — managing visitor permits, waitlists, space
          availability, and vehicle review while involving residents or
          administrators only when needed.
        </p>
        <div className="hero__actions">
          <Link to="/resident" className="btn btn--primary">
            Resident Portal
          </Link>
          <Link to="/admin" className="btn btn--secondary">
            Admin Dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
