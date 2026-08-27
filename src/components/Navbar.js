import { Link, useLocation } from 'react-router-dom';
import logo from '../asset/logo.png';
import './Navbar.css';

export default function Navbar() {
  const { pathname } = useLocation();

  return (
    <header className="navbar" role="banner">
      <div className="navbar__inner">
        <Link to="/" className="navbar__brand" aria-label="SpotOn home">
          <span className="navbar__logo-wrap">
            <img src={logo} alt="SpotOn logo" className="navbar__logo" />
          </span>
          <span className="navbar__name">SpotOn</span>
        </Link>
        <nav aria-label="Main navigation">
          <ul className="navbar__links" role="list">
            <li>
              <Link
                to="/resident"
                className={`navbar__link${pathname === '/resident' ? ' navbar__link--active' : ''}`}
                aria-current={pathname === '/resident' ? 'page' : undefined}
              >
                Resident Portal
              </Link>
            </li>
            <li>
              <Link
                to="/admin"
                className={`navbar__link navbar__link--btn${pathname === '/admin' ? ' navbar__link--active' : ''}`}
                aria-current={pathname === '/admin' ? 'page' : undefined}
              >
                Admin Dashboard
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
