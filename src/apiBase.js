// Base URL for the SpotOn backend.
//
// Defaults to the local FastAPI dev server, so `npm start` with no configuration
// behaves exactly as before. Set REACT_APP_API_BASE in .env to point at a deployed
// backend — that is how this switches between local, ECS Express, and (later) a
// production URL without touching component code.
//
// CRA only exposes variables prefixed REACT_APP_, and reads them at build/start
// time — changing .env requires restarting the dev server.
export const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
