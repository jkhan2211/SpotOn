# SpotOn — AI-Powered Community Parking Coordinator

SpotOn is a smart visitor parking management system for residential communities. It uses an AI agent to automate permit issuance, waitlist management, and vehicle review — reducing manual overhead for property managers while giving residents a seamless self-serve experience.

## Features

- **Resident Portal** — Request visitor permits, join the waitlist, extend or release permits via a conversational AI agent
- **Admin Dashboard** — Live site plan with real-time parking state, vehicle review queue, waitlist management, and activity log
- **AI Agent (SpotOn)** — Handles permit workflows, no-show enforcement, early releases, reallocation, and unknown vehicle flagging
- **Site Plan** — Visual map of the community with colour-coded stall states (available, reserved, active, temporary, under review)
- **Unknown Vehicle Handling** — Unrecognised vehicles are flagged amber on the admin view and shown as "Not in Service" on the resident view

## Tech Stack

- React (Create React App)
- CSS custom properties — no external UI library
- All data is mocked/simulated for demo purposes

## Getting Started

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
src/
├── admin/        # Admin dashboard, site plan, agent panel, data & demo hook
├── resident/     # Resident portal, site plan, agent panel, data & demo hook
├── components/   # Shared landing page components (Navbar, Hero, Features, etc.)
├── pages/        # Top-level page components (HomePage, ResidentPage, AdminPage)
└── asset/        # Static assets (logo, etc.)
```

## Demo

| View | Route |
|------|-------|
| Landing | `/` |
| Resident Portal | `/resident` |
| Admin Dashboard | `/admin` |

> All names, units, plates, and permit data are fictional and simulated.
