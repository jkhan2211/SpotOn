import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer" role="contentinfo">
      <div className="footer__inner">
        <p className="footer__text">
          Built with{' '}
          <span className="footer__highlight">Strands Agents + AWS</span>
        </p>
        <p className="footer__sub">Agents for Humans Hackathon 2026</p>
      </div>
    </footer>
  );
}
