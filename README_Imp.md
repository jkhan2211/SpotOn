# SpotOn — Persistence Refactor (CSV → Pluggable Repository)

This document records the repository-pattern refactor that decouples FastAPI
routes and Strands Agent tools from CSV specifically, so a future
`DynamoDBRepository` can replace `CsvRepository` without touching FastAPI,
Strands tools, agent prompts, React, or business behaviour.

## 1. Original CSV-access inventory

| File | Function | Entity/CSV | R/W | FastAPI endpoint(s) | Strands tool(s) | Business logic mixed in |
|---|---|---|---|---|---|---|
| main.py | `parking_spaces()` | spaces + permits | R | `GET /api/parking-spaces` | — | Join spaces→permit, response shaping |
| parking_tools.py | `lookup_resident_by_unit` | residents | R | (via chat) | `identify_resident` | Multi-match disambiguation, active/enabled guard |
| parking_tools.py | `_lookup_resident_by_id` | residents | R | (via release/waitlist) | — | — |
| parking_tools.py | `_get_active_vehicles` | vehicles | R | (via chat) | `get_resident_vehicles`, used by `create_temporary_resident_permit` | "active" filter, shape to {plate,make,model} |
| parking_tools.py | `_assign_space_and_create_permit` | spaces + permits | R/W | (via chat, waitlist accept) | used by `create_permit`, `create_temporary_resident_permit`, `accept_waitlist_offer` | Space-assignment strategy, past-time guard, permit_id generation |
| parking_tools.py | `check_parking_availability` | spaces | R | (via chat) | `check_parking_availability` | — |
| parking_tools.py | `create_permit` | spaces+permits (via above) | R/W | (via chat) | `create_permit` | Email dispatch |
| parking_tools.py | `create_temporary_resident_permit` | vehicles, spaces+permits | R/W | (via chat) | `create_temporary_resident_permit` | Vehicle-ownership validation, email dispatch |
| parking_tools.py | `release_permit` | permits, spaces | R/W | `POST /api/permits/{id}/release` | — (deterministic UI action) | Idempotency guard, occupant-label branching, triggers waitlist match + emails |
| parking_tools.py | `get_permit_status` | permits | R | (via chat) | `get_permit_status` | — |
| parking_tools.py | `join_waitlist` | waitlist | R/W | (via chat) | `join_waitlist` | Expiry guard |
| parking_tools.py | `_match_waitlist_for_released_space` | waitlist | R | (via release) | — | FIFO matching, expiry filtering |
| parking_tools.py | `_offer_space_to_waitlist_entry` | waitlist, spaces | R/W | (via release) | — | Email dispatch |
| parking_tools.py | `get_waitlist_offers` | waitlist | R | `GET /api/waitlist/offers` | — | Filter by resident+status |
| parking_tools.py | `accept_waitlist_offer` | waitlist, spaces+permits | R/W | `POST /api/waitlist/{id}/accept` | — | Idempotency guard, email dispatch |
| parking_tools.py | `decline_waitlist_offer` | waitlist, spaces | R/W | `POST /api/waitlist/{id}/decline` | — | Idempotency guard |
| vehicle_reports.py | `_lookup_resident_vehicle` | vehicles, residents | R | (via admin chat) | used by `report_and_check_vehicle` | active+plate-normalize filter |
| vehicle_reports.py | `_lookup_active_permit` | permits | R | (via admin chat) | used by `report_and_check_vehicle` | Time-window match logic |
| vehicle_reports.py | `report_and_check_vehicle` | unknown_vehicle, spaces | R/W | (via admin chat) | `report_and_check_vehicle` | Match reasoning, "don't downgrade a more specific space state" rule |
| vehicle_reports.py | `get_vehicle_reports` | unknown_vehicle | R | `GET /api/admin/vehicle-reports` | — | — |
| vehicle_reports.py | `mark_expected` | unknown_vehicle | R/W | `POST /.../expected` | — | Idempotency guard |
| vehicle_reports.py | `notify_security` | unknown_vehicle | R/W | `POST /.../notify-security` | — | Idempotency guard, email dispatch |

## 2–3. Repository design and structure

Created `spoton_backend_app/repositories/`:

- **base_repository.py** — `Repository(ABC)` with 19 methods derived directly from the inventory above (residents/vehicles are read-only — nothing ever wrote them).
- **csv_repository.py** — `CsvRepository(Repository)`, owns the CSV paths, fieldname constants, and the `_read_csv`/`_write_csv`/`_find_by_id`/`_update_by_id` primitives (moved here from parking_tools.py).
- **repository_factory.py** — `get_repository()` singleton; `SPOTON_DATA_BACKEND=csv` (default) → `CsvRepository`; `dynamodb` → clear `NotImplementedError`; anything else → clear `ValueError`. Both verified live.

**Files modified:** `main.py`, `tools/parking_tools.py`, `tools/vehicle_reports.py`, `.env`, `.env.example`.

**Files created:** `repositories/__init__.py`, `base_repository.py`, `csv_repository.py`, `repository_factory.py`.

## 4–7. How access works now

FastAPI (main.py) and both tool modules each do `_repo = get_repository()` once at import time and call only repository methods (`get_spaces`, `get_permit`, `update_waitlist_entry`, etc.) — zero raw `csv`/`open()` calls remain in any of them (verified by grep). Business logic (idempotency guards, FIFO matching, disambiguation, space-assignment strategy) stayed exactly where it was, just swapped its I/O calls. **CSV remains the working backend** — confirmed via the regression run.

## 8–9. Tests run

Two layers, both passing completely:

1. **Direct-function regression** (bypassing HTTP/LLM for speed) — all 13 required workflows, **13/13 PASS**, including cross-resident email routing (Netty vs. Silvano) and the "don't downgrade a more-specific space state" rule.
2. **HTTP-level smoke test** — `GET /`, `GET /api/parking-spaces` (including the space↔permit join), chat-driven booking, release, admin vehicle report, mark-expected, plus 404 paths for bogus permit/waitlist ids — all correct.

Frontend: `git diff --stat src/` is empty — **zero React files touched**, confirming the contract is untouched.

**Not verifiable in this environment:** real SES delivery end-to-end (tested via mock mode + one earlier live sanity send in a prior task, not re-verified live here to avoid burning quota); concurrent/race-condition behavior under simultaneous requests (single-threaded dev server, not exercised).

## 10. DynamoDB readiness report

| Table | PK | SK | Key attributes | Access patterns | GSI? |
|---|---|---|---|---|---|
| spoton-residents | resident_id | — | unit_number, first_name, last_name, email, status, parking_privileges | `get_resident_by_id` (direct); `get_residents_by_unit` needs unit lookup | GSI on `unit_number` |
| spoton-vehicles | vehicle_id | — | resident_id, plate, make, model, status | `get_active_vehicles_by_resident` (by resident_id); `get_active_vehicle_by_plate` (by plate) | GSI on `resident_id`, GSI on `plate` |
| spoton-spaces | space_id | — | space_type, status, current_permit_id | `get_spaces` (scan, only 10 rows — fine); `get_space`/`update_space` (direct) | None needed |
| spoton-permits | permit_id | — | resident_id, visitor_name/plate, space_id, start/end_time, status, permit_type | `get_permit`/`update_permit` (direct); filtering by space_id/plate/type happens in-memory today | GSI on `resident_id` if per-resident permit history is ever queried directly (not currently needed) |
| spoton-waitlist | waitlist_id | — | resident_id, request_type, status, offered_space_id, offered_at, created_at | `get_waitlist_entry`/`update_waitlist_entry` (direct); FIFO match scans all + filters `status=="waiting"` | GSI on `status` (or `status`+`created_at` as sort key) would make FIFO matching a query instead of a scan |
| spoton-vehicle-reports | report_id | — | space_id, plate, status, match flags, reasoning, timestamps | `get_vehicle_report`/`update_vehicle_report` (direct); admin dashboard reads all and filters `status=="requires_review"` client-side | GSI on `status` would help once report volume grows past hackathon scale |

**Repository method → DynamoDB requirement mapping** (representative):

- `get_resident_by_id` → `GetItem` on spoton-residents
- `get_residents_by_unit` → `Query` on the unit_number GSI
- `get_active_vehicle_by_plate` → `Query` on the plate GSI, filter status=active
- `get_space`/`update_space` → `GetItem`/`UpdateItem` on spoton-spaces
- `add_permit` → `PutItem` on spoton-permits
- `_assign_space_and_create_permit`'s "claim a space" step → **conditional `UpdateItem`** on spoton-spaces (`ConditionExpression: status = :available_or_offered`), so two simultaneous bookings can't both win the same space — CSV today has no such protection (a real race, currently just unlikely at hackathon traffic)
- `accept_waitlist_offer` → **conditional `UpdateItem`** on the waitlist entry (`ConditionExpression: status = :offered`) before creating the permit, for the same reason
- `release_permit` → could be a **transaction** (`TransactWriteItems`) across spoton-permits (mark released) + spoton-spaces (mark available) so the two never disagree if a crash happens mid-way — CSV today writes them sequentially with no rollback

## 11. Config to activate DynamoDB later

```
SPOTON_DATA_BACKEND=dynamodb
```

plus, once `DynamoDBRepository` exists: AWS region/table-name env vars and IAM permissions for the 6 tables above — none of that exists yet, by design.

## 12. What a future DynamoDBRepository must implement

Exactly the same 19-method `Repository` contract in base_repository.py — nothing more. It plugs into `repository_factory.py`'s existing `dynamodb` branch (currently a `NotImplementedError` placeholder), and the moment it's real, FastAPI, both Strands tool modules, both agent prompts, and the entire React frontend need zero changes.

## Method inventory — main.py, Strands tools, agents

### main.py (FastAPI routes)

| Method/route | One-liner |
|---|---|
| `root()` | Health check |
| `parking_spaces()` | List all spaces joined with their current permit |
| `chat()` | Resident chat turn → resident agent |
| `reset_chat()` | Wipe all resident agent sessions + resident context |
| `release()` | Release/cancel a permit |
| `waitlist_offers()` | Poll for a resident's currently-offered waitlist entries |
| `waitlist_accept()` | Accept a waitlist offer → creates a real permit |
| `waitlist_decline()` | Decline a waitlist offer → space returns to available |
| `admin_chat()` | Admin chat turn → admin agent |
| `admin_chat_reset()` | Wipe all admin agent sessions |
| `admin_vehicle_reports()` | List all unknown-vehicle reports |
| `admin_vehicle_report_expected()` | Mark a report "Expected" (human decision) |
| `admin_vehicle_report_notify_security()` | Report to Security (human decision, sends real email) |

### tools/parking_tools.py (resident-side)

| Function | One-liner |
|---|---|
| `identify_resident` (@tool) | Resolve unit number → resident, establish session identity |
| `check_parking_availability` (@tool) | Count available/occupied visitor spaces |
| `create_permit` (@tool) | Book a visitor permit, assign first free space, email confirmation |
| `get_resident_vehicles` (@tool) | List the current resident's registered active vehicles |
| `create_temporary_resident_permit` (@tool) | Book the resident's own vehicle into a space |
| `get_permit_status` (@tool) | Look up a permit's live status (guards against stale agent memory) |
| `join_waitlist` (@tool) | Add the resident's request to the waitlist when full |
| `release_permit` | Release/cancel a permit, trigger waitlist match if applicable |
| `get_waitlist_offers` | Read-only poll for a session's current offer |
| `accept_waitlist_offer` | Accept an offer → creates the real permit |
| `decline_waitlist_offer` | Decline an offer → frees the space |
| `lookup_resident_by_unit` | Deterministic resident lookup (used by `identify_resident`) |
| `set_current_session` / `get_current_resident` / `clear_all_sessions` | Per-session resident-identity bookkeeping |

### tools/vehicle_reports.py (admin-side)

| Function | One-liner |
|---|---|
| `report_and_check_vehicle` (@tool) | Log a human-observed vehicle, check it against resident/visitor/temp records |
| `get_vehicle_reports` | List all unknown-vehicle reports |
| `mark_expected` | Human decision: dismiss a report, no space/email change |
| `notify_security` | Human decision: escalate, sends real security email |
| `normalize_plate` | Whitespace/casing-insensitive plate comparison |

### agent/spoton_agent.py

`create_agent(tz_name)` builds the resident-facing Strands `Agent` (unit-gated, timezone-aware system prompt); `get_agent_for_session(session_id, tz_name)` returns a per-browser-tab agent instance; `reset_all_sessions()` wipes them all.

### agent/admin_agent.py

`create_admin_agent()` builds the admin-facing Strands `Agent` (single tool: `report_and_check_vehicle`, never makes enforcement decisions); `get_admin_agent_for_session(session_id)` / `reset_all_admin_sessions()` mirror the resident agent's session pattern.
