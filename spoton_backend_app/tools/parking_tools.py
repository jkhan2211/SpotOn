import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from strands import tool
from repositories import get_repository
from services.email_service import (
    send_permit_confirmation_email,
    send_visitor_admin_notification,
    send_temp_resident_confirmation_email,
    send_temp_resident_admin_notification,
    send_release_confirmation_email,
    send_release_admin_notification,
    send_waitlist_offer_email,
)

load_dotenv(Path(__file__).parent.parent / ".env")

# shared dict populated by create_permit() / create_temporary_resident_permit(), read by main.py after agent call
last_created_permit: dict = {}

# All persistence goes through this — CSV today, pluggable later (see
# repositories/). Business logic below never touches a CSV path directly.
_repo = get_repository()


def _is_past(iso_time: str) -> bool:
    """True if iso_time can't be parsed, or parses to a moment already behind us —
    used to reject bookings/waitlist joins for a time window that's already over."""
    try:
        dt = datetime.fromisoformat(iso_time.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True
    return dt < datetime.now(timezone.utc)


# ── Resident session context ──────────────────────────────────────────────────
# NOTE for the hackathon prototype: unit lookup is used to establish resident
# context. This is NOT authentication — anyone who knows (or guesses) a valid
# unit number can identify as that resident. A production implementation would
# resolve identity from an authenticated session instead. It's a realistic demo
# approximation of identity + personalization + workflow ownership, no more.
#
# In-memory, keyed by session_id (one browser tab/session): {"resident": dict|None}.
# main.py sets which session_id is "current" before invoking that session's agent,
# so tools below can read/write the right resident context without the LLM ever
# having to pass a session_id argument through itself.
_SESSIONS: dict[str, dict] = {}
_current_session_id: str | None = None


def set_current_session(session_id: str, tz_name: str | None = None) -> None:
    global _current_session_id
    _current_session_id = session_id
    session = _SESSIONS.setdefault(session_id, {"resident": None, "timezone": None})
    if tz_name:
        session["timezone"] = tz_name


def get_current_resident() -> dict | None:
    if _current_session_id is None:
        return None
    return _SESSIONS.get(_current_session_id, {}).get("resident")


def get_current_timezone() -> str | None:
    """The current session's browser-reported IANA timezone (e.g.
    "America/Toronto"), set on each /api/chat call — used so booking
    confirmation emails show times the resident actually asked for, not UTC."""
    if _current_session_id is None:
        return None
    return _SESSIONS.get(_current_session_id, {}).get("timezone")


def _set_current_resident(resident: dict | None) -> None:
    if _current_session_id is None:
        return
    _SESSIONS.setdefault(_current_session_id, {})["resident"] = resident


def clear_all_sessions() -> None:
    """Used by /api/chat/reset for a full operator wipe during testing."""
    _SESSIONS.clear()


def lookup_resident_by_unit(unit_number: str, first_name: str | None = None) -> dict:
    """Deterministic residents.csv lookup — no LLM involved in resolving identity.

    Returns one of:
      {"status": "ok", "resident_id", "unit_number", "first_name", "last_name", "email"}
      {"status": "not_found", "message"}
      {"status": "multiple", "message", "candidates": [first_name, ...]}
      {"status": "inactive", "message"}
    """
    normalized = "".join(ch for ch in (unit_number or "") if ch.isdigit())
    if not normalized:
        return {"status": "not_found", "message": f"{unit_number!r} doesn't look like a valid unit number."}

    matches = _repo.get_residents_by_unit(normalized)
    if not matches:
        return {"status": "not_found", "message": f"No resident found for unit {normalized}."}

    if first_name:
        narrowed = [r for r in matches if r["first_name"].strip().lower() == first_name.strip().lower()]
        if not narrowed:
            return {"status": "not_found", "message": f"No resident named {first_name} found at unit {normalized}."}
        matches = narrowed

    if len(matches) > 1:
        return {
            "status": "multiple",
            "message": f"More than one resident is registered to unit {normalized}.",
            "candidates": [r["first_name"] for r in matches],
        }

    row = matches[0]
    if row["status"] != "active" or row["parking_privileges"] != "enabled":
        return {
            "status": "inactive",
            "message": (
                f"Unit {normalized} is on file for {row['first_name']} {row['last_name']}, but this "
                f"account can't currently create parking requests (status={row['status']}, "
                f"parking_privileges={row['parking_privileges']})."
            ),
        }

    return {
        "status": "ok",
        "resident_id": row["resident_id"],
        "unit_number": row["unit_number"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"],
    }


def _lookup_resident_by_id(resident_id: str) -> dict | None:
    """Looks up a resident's own record (unit, name, email) by resident_id — used
    wherever the acting resident isn't the current session's identified resident,
    e.g. sending a waitlist offer to whoever is waiting, not whoever released."""
    return _repo.get_resident_by_id(resident_id)


def _get_active_vehicles(resident_id: str) -> list[dict]:
    return [
        {"plate": v["plate"], "make": v["make"], "model": v["model"]}
        for v in _repo.get_active_vehicles_by_resident(resident_id)
    ]


def _assign_space_and_create_permit(
    resident_id: str, occupant_name: str, plate: str,
    start_time: str, end_time: str, permit_type: str, reason: str,
    require_space_id: str | None = None,
) -> tuple[dict | None, dict]:
    """Shared by visitor and temporary-resident bookings: assigns the first available
    space and persists the permit. Returns (permit_row, meta) or (None, error_dict).

    If require_space_id is given (waitlist-offer acceptance), target that exact space
    instead of auto-picking — it must currently be "offered", not just "available",
    since an offered space is deliberately held out of the normal available pool.

    The reserve+create-permit step goes through the repository's
    reserve_space_and_add_permit(), which persists both atomically and reports back
    if the space's status had already moved out from under us (a concurrent booking
    won the race). In the auto-pick case, on that outcome we simply try the next
    still-available candidate from this same read — same "first available" result
    in the normal case, just resilient to a lost race instead of silently
    double-booking.
    """
    if _is_past(end_time):
        return None, {"error": f"The requested end time {end_time} has already passed."}

    spaces = _repo.get_spaces()
    if require_space_id is not None:
        candidates = [require_space_id]
        required_status = "offered"
        not_available_error = f"Space {require_space_id} is no longer held for this offer."
    else:
        candidates = [r["space_id"] for r in spaces if r["status"] == "available"]
        required_status = "available"
        not_available_error = "No parking spaces are currently available."

    if not candidates:
        return None, {"error": not_available_error}

    permit_id = f"SP-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.now(timezone.utc).isoformat()

    def _permit_for(space_id: str) -> dict:
        return {
            "permit_id": permit_id,
            "resident_id": resident_id,
            "visitor_name": occupant_name,
            "visitor_plate": plate.upper(),
            "space_id": space_id,
            "start_time": start_time,
            "end_time": end_time,
            "status": "upcoming",
            "permit_type": permit_type,
            "reason": reason,
            "created_at": now,
        }

    new_permit = None
    reserved_space_id = None
    for space_id in candidates:
        new_permit = _repo.reserve_space_and_add_permit(space_id, required_status, _permit_for(space_id))
        if new_permit is not None:
            reserved_space_id = space_id
            break

    if new_permit is None:
        return None, {"error": not_available_error}

    remaining = [r["space_id"] for r in spaces if r["status"] == "available" and r["space_id"] != reserved_space_id]
    return new_permit, {"remaining_available_spaces": remaining, "total_spaces": len(spaces)}


@tool
def identify_resident(unit_number: str, first_name: str | None = None) -> dict:
    """
    Establish (or re-confirm) which resident is using SpotOn this session, from their
    unit number. Call this before create_permit(), create_temporary_resident_permit(),
    get_resident_vehicles(), or join_waitlist() if resident context hasn't been
    established yet in this conversation. Extract just the digits from however the
    resident phrases their unit (e.g. "Unit 24", "I'm in 24", "#24" all mean
    unit_number="24") — never invent or guess a unit number.

    If the result's status is "multiple", more than one resident is registered to that
    unit — ask the resident their first name and call this again with the same
    unit_number plus first_name to disambiguate. Never guess which one they are.

    If the result's status is "inactive", the resident exists but their account can't
    currently make parking requests — relay the reason and do not proceed with any
    booking/waitlist action.

    If the result's status is "not_found", ask the resident to double-check their unit
    number — do not invent a resident or continue as if one was found.

    On status "ok", resident context is now saved for this session — greet the resident
    by their first_name once, briefly, and do not ask for their unit again this
    conversation. If they'd already started describing a request before you asked for
    their unit, continue that same request now instead of asking them to repeat it.

    Args:
        unit_number: The unit number as stated by the resident.
        first_name: Only pass this on a second call, if the first call for this same
            unit_number returned status="multiple".

    Returns:
        dict: status ("ok"/"not_found"/"multiple"/"inactive") plus supporting details.
    """
    result = lookup_resident_by_unit(unit_number, first_name)
    if result["status"] == "ok":
        _set_current_resident({
            "resident_id": result["resident_id"],
            "unit_number": result["unit_number"],
            "first_name": result["first_name"],
            "last_name": result["last_name"],
            "name": f'{result["first_name"]} {result["last_name"]}',
            "email": result["email"],
        })
    return result


@tool
def check_parking_availability() -> dict:
    """
    Check current visitor parking availability from the community parking data.

    Returns:
        dict: Available spaces list, occupied count, and total count.
    """
    rows = _repo.get_spaces()
    available = [r["space_id"] for r in rows if r["status"] == "available"]
    return {
        "available_spaces": available,
        "available_count": len(available),
        "occupied_count": len(rows) - len(available),
        "total_spaces": len(rows),
    }


@tool
def create_permit(visitor_name: str, visitor_plate: str, start_time: str, end_time: str) -> dict:
    """
    Create a visitor parking permit and assign the first available space.

    Args:
        visitor_name: First name of the visitor.
        visitor_plate: Licence plate of the visitor's vehicle.
        start_time: Permit start time in ISO 8601 format (e.g. 2025-07-10T19:00:00Z).
        end_time: Permit end time in ISO 8601 format (e.g. 2025-07-10T22:00:00Z).

    Returns:
        dict: Created permit details including permit_id and assigned space_id, or an
        error — including if no resident context has been established yet for this
        conversation (call identify_resident() first in that case).
    """
    resident = get_current_resident()
    if resident is None:
        return {"error": "No resident identified for this session yet. Call identify_resident() first."}

    new_permit, meta = _assign_space_and_create_permit(
        resident_id=resident["resident_id"],
        occupant_name=visitor_name,
        plate=visitor_plate,
        start_time=start_time,
        end_time=end_time,
        permit_type="visitor",
        reason="",
    )
    if new_permit is None:
        return meta

    result = {
        "permit_id": new_permit["permit_id"],
        "space_id": new_permit["space_id"],
        "visitor_name": visitor_name,
        "visitor_plate": new_permit["visitor_plate"],
        "start_time": start_time,
        "end_time": end_time,
        "status": "upcoming",
        "remaining_available_spaces": meta["remaining_available_spaces"],
    }

    resident_email = send_permit_confirmation_email(
        recipient_email=resident["email"],
        permit_id=new_permit["permit_id"],
        visitor_name=visitor_name,
        visitor_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=start_time,
        end_time=end_time,
        available_spaces=len(meta["remaining_available_spaces"]),
        total_spaces=meta["total_spaces"],
        tz_name=get_current_timezone(),
    )
    admin_email = send_visitor_admin_notification(
        recipient_email=os.environ.get("SPOTON_SECURITY_EMAIL", ""),
        permit_id=new_permit["permit_id"],
        resident_unit=resident["unit_number"],
        visitor_name=visitor_name,
        visitor_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=start_time,
        end_time=end_time,
        tz_name=get_current_timezone(),
    )
    result["resident_email"] = resident["email"]

    result["resident_email_sent"] = resident_email.get("success", False)
    result["admin_email_sent"] = admin_email.get("success", False)

    last_created_permit.clear()
    last_created_permit.update(result)
    return result


@tool
def get_resident_vehicles() -> dict:
    """
    Look up the current resident's identity and their registered, active vehicles.

    Call this before creating a temporary resident parking permit, so you know which
    vehicle(s) the resident actually has on file. If there is exactly one active vehicle,
    it's fine to use it automatically. If there is more than one, ask the resident which
    vehicle they mean before calling create_temporary_resident_permit().

    Returns:
        dict: resident_id, resident_name, unit_number, and a list of active vehicles
        (each with plate, make, model), or an error if no resident context has been
        established yet for this conversation (call identify_resident() first).
    """
    resident = get_current_resident()
    if resident is None:
        return {"error": "No resident identified for this session yet. Call identify_resident() first."}
    vehicles = _get_active_vehicles(resident["resident_id"])
    return {
        "resident_id": resident["resident_id"],
        "resident_name": resident["name"],
        "unit_number": resident["unit_number"],
        "vehicles": vehicles,
    }


@tool
def create_temporary_resident_permit(vehicle_plate: str, start_time: str, end_time: str, reason: str) -> dict:
    """
    Create a temporary resident parking permit for the resident's OWN registered vehicle —
    NOT a visitor. Use this when a resident needs somewhere to park because their own
    driveway/garage is blocked, being cleaned, or worked on (e.g. contractor, driveway
    cleaning, moving). Do not use this for guests or visitors — use create_permit() for those.

    Call get_resident_vehicles() first to find the resident's registered vehicle(s) and
    resolve which plate to pass here (auto-select if there's only one, otherwise ask the
    resident which vehicle they mean).

    Args:
        vehicle_plate: Licence plate of the resident's own registered vehicle. Must match
            one of the vehicles returned by get_resident_vehicles() — never invent a plate.
        start_time: Requested start time in ISO 8601 UTC format (e.g. 2025-07-10T15:00:00Z).
        end_time: Requested end time in ISO 8601 UTC format (e.g. 2025-07-10T20:00:00Z).
        reason: The resident's own stated reason (e.g. "driveway cleaning"). Never invent one.

    Returns:
        dict: Created permit details, or an error if the plate isn't one of the resident's
        registered vehicles, no resident context is established yet, or no spaces are
        currently available.
    """
    resident = get_current_resident()
    if resident is None:
        return {"error": "No resident identified for this session yet. Call identify_resident() first."}

    vehicles = _get_active_vehicles(resident["resident_id"])
    plate_norm = vehicle_plate.strip().upper()
    match = next((v for v in vehicles if v["plate"].upper() == plate_norm), None)
    if match is None:
        return {"error": f"{vehicle_plate} is not one of the resident's registered vehicles."}

    new_permit, meta = _assign_space_and_create_permit(
        resident_id=resident["resident_id"],
        occupant_name=resident["name"],
        plate=plate_norm,
        start_time=start_time,
        end_time=end_time,
        permit_type="temporary_resident",
        reason=reason,
    )
    if new_permit is None:
        return meta

    result = {
        "permit_id": new_permit["permit_id"],
        "space_id": new_permit["space_id"],
        "visitor_name": resident["name"],
        "visitor_plate": new_permit["visitor_plate"],
        "vehicle_plate": new_permit["visitor_plate"],
        "start_time": start_time,
        "end_time": end_time,
        "reason": reason,
        "permit_type": "temporary_resident",
        "status": "upcoming",
        "remaining_available_spaces": meta["remaining_available_spaces"],
    }

    resident_email = send_temp_resident_confirmation_email(
        recipient_email=resident["email"],
        permit_id=new_permit["permit_id"],
        vehicle_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=start_time,
        end_time=end_time,
        reason=reason,
        tz_name=get_current_timezone(),
    )
    admin_email = send_temp_resident_admin_notification(
        recipient_email=os.environ.get("SPOTON_SECURITY_EMAIL", ""),
        permit_id=new_permit["permit_id"],
        resident_unit=resident["unit_number"],
        vehicle_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=start_time,
        end_time=end_time,
        reason=reason,
        tz_name=get_current_timezone(),
    )

    result["resident_email_sent"] = resident_email.get("success", False)
    result["admin_email_sent"] = admin_email.get("success", False)
    result["resident_email"] = resident["email"]

    last_created_permit.clear()
    last_created_permit.update(result)
    return result


# Deterministic UI action (release/cancel button) — plain function, not a Strands
# @tool, since the agent doesn't need to be involved in this flow.
def release_permit(permit_id: str, tz_name: str | None = None) -> dict:
    """
    Release/cancel a permit by id and free its assigned parking space. Works for both
    permit_type = visitor and permit_type = temporary_resident. Idempotent: calling it
    again on an already-released permit is a safe no-op, not a second free.

    tz_name (the releasing resident's browser-reported IANA timezone) is used only
    to display the original booking's date/time in the confirmation email; it plays
    no role in the release logic itself.
    """
    permit = _repo.get_permit(permit_id)
    if permit is None:
        return {"error": "not_found", "message": f"No permit found with id {permit_id}."}

    if permit["status"] != "upcoming":
        return {
            "success": True,
            "already_released": True,
            "permit_id": permit_id,
            "space_id": permit["space_id"],
            "permit_status": permit["status"],
            "message": f"Permit {permit_id} was already {permit['status']}.",
        }

    space_id = permit["space_id"]
    # Atomic: permit upcoming->released and space (if still linked to this permit)
    # reserved->available happen together, or not at all — closes the race the
    # status check above can't, since another request could release the same
    # permit between that check and this write.
    released = _repo.release_permit_and_free_space(permit_id, space_id)
    if released is None:
        current = _repo.get_permit(permit_id) or permit
        return {
            "success": True,
            "already_released": True,
            "permit_id": permit_id,
            "space_id": current["space_id"],
            "permit_status": current["status"],
            "message": f"Permit {permit_id} was already {current['status']}.",
        }

    result = {
        "success": True,
        "permit_id": permit_id,
        "space_id": space_id,
        "permit_status": "released",
        "space_status": "available",
        "permit_type": permit["permit_type"],
        "visitor_name": permit["visitor_name"],
        "visitor_plate": permit["visitor_plate"],
        "start_time": permit["start_time"],
        "end_time": permit["end_time"],
        "message": f"Parking space {space_id} has been released successfully.",
    }

    if permit["permit_type"] == "temporary_resident":
        # visitor_name holds the resident's own name for this permit_type; the plate
        # is what belongs under a "Vehicle" label, not the resident's name.
        occupant_label, occupant_name = "Vehicle", permit["visitor_plate"]
    else:
        occupant_label, occupant_name = "Visitor", permit["visitor_name"]

    releasing_resident = _lookup_resident_by_id(permit["resident_id"])
    resident_email = send_release_confirmation_email(
        recipient_email=releasing_resident["email"] if releasing_resident else "",
        permit_id=permit_id,
        space_id=space_id,
        occupant_label=occupant_label,
        occupant_name=occupant_name,
        start_time=permit["start_time"],
        end_time=permit["end_time"],
        tz_name=tz_name,
    )
    admin_email = send_release_admin_notification(
        recipient_email=os.environ.get("SPOTON_SECURITY_EMAIL", ""),
        permit_id=permit_id,
        permit_type=permit["permit_type"],
        space_id=space_id,
    )

    result["resident_email_sent"] = resident_email.get("success", False)
    result["admin_email_sent"] = admin_email.get("success", False)

    # deterministic waitlist matching — the backend, not the LLM, decides this
    match = _match_waitlist_for_released_space()
    if match is not None:
        offer = _offer_space_to_waitlist_entry(match["waitlist_id"], space_id)
        result["waitlist_offer"] = offer

    return result


@tool
def get_permit_status(permit_id: str) -> dict:
    """
    Look up the current, real status of a permit by id.

    Call this before telling a resident that a visitor or vehicle "already has a
    permit" based on something created earlier in this conversation — a permit can be
    released or cancelled outside the chat (e.g. via the UI's Release button), and your
    own memory of creating it does not reflect that. If this shows the permit is no
    longer "upcoming" (e.g. released or cancelled), treat any related new request as a
    fresh booking rather than assuming it's a duplicate.

    Args:
        permit_id: The permit id to check (e.g. "SP-41EC83").

    Returns:
        dict: permit_id, status, space_id, visitor_name, permit_type — or an error if
        no permit exists with that id.
    """
    permit = _repo.get_permit(permit_id)
    if permit is None:
        return {"error": f"No permit found with id {permit_id}."}
    return {
        "permit_id": permit["permit_id"],
        "status": permit["status"],
        "space_id": permit["space_id"],
        "visitor_name": permit["visitor_name"],
        "permit_type": permit["permit_type"],
    }


@tool
def join_waitlist(
    start_time: str,
    end_time: str,
    visitor_name: str | None = None,
    visitor_plate: str | None = None,
    request_type: str = "visitor",
) -> dict:
    """
    Add the resident's request to the waitlist when no parking space is currently
    available. Only call this AFTER the resident has explicitly agreed to be added —
    never join them to the waitlist without asking first, and never promise a space
    will become available.

    Args:
        start_time: Requested start time in ISO 8601 UTC format.
        end_time: Requested end time in ISO 8601 UTC format.
        visitor_name: The visitor's name (for request_type="visitor").
        visitor_plate: The visitor's licence plate (for request_type="visitor").
        request_type: "visitor" or "temporary_resident".

    Returns:
        dict: waitlist_id and status="waiting", or an error.
    """
    resident = get_current_resident()
    if resident is None:
        return {"error": "No resident identified for this session yet. Call identify_resident() first."}

    now_dt = datetime.now(timezone.utc)
    try:
        end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
    except ValueError:
        return {"error": f"end_time {end_time!r} is not a valid ISO 8601 timestamp."}
    if end_dt < now_dt:
        # Deterministic guard, not just an LLM instruction — a waitlist entry whose
        # window has already passed can never be matched (release matching skips
        # stale entries), so it would sit there forever looking "waiting" but dead.
        return {
            "error": (
                f"The requested window ends at {end_time}, which has already passed "
                f"(current time is {now_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}). Ask the "
                "resident whether they meant a still-upcoming time today or tomorrow."
            )
        }

    waitlist_id = f"WL-{uuid.uuid4().hex[:6].upper()}"
    now = now_dt.isoformat()
    row = {
        "waitlist_id": waitlist_id,
        "resident_id": resident["resident_id"],
        "request_type": request_type,
        "visitor_name": visitor_name or resident["name"],
        "visitor_plate": (visitor_plate or "").upper(),
        "start_time": start_time,
        "end_time": end_time,
        "status": "waiting",
        "offered_space_id": "",
        "offered_at": "",
        "permit_id": "",
        "created_at": now,
    }
    _repo.add_waitlist_entry(row)

    return {"success": True, "waitlist_id": waitlist_id, "status": "waiting"}


def _match_waitlist_for_released_space() -> dict | None:
    """Deterministic FIFO match — no LLM involved. Picks the oldest still-relevant
    ("waiting", not already past its end_time) waitlist entry. Does not touch any
    state; the caller decides what space to offer it."""
    entries = _repo.get_waitlist_entries()
    now = datetime.now(timezone.utc)
    candidates = []
    for e in entries:
        if e["status"] != "waiting":
            continue
        try:
            end = datetime.fromisoformat(e["end_time"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if end < now:
            continue
        candidates.append(e)
    if not candidates:
        return None
    candidates.sort(key=lambda e: e["created_at"])
    return candidates[0]


def _offer_space_to_waitlist_entry(waitlist_id: str, space_id: str) -> dict:
    """Marks a space 'offered' and the matching waitlist row 'offered', then sends
    the offer email. Called by release_permit() right after a space is freed."""
    now = datetime.now(timezone.utc).isoformat()

    entry = _repo.update_waitlist_entry(waitlist_id, status="offered", offered_space_id=space_id, offered_at=now)
    _repo.update_space(space_id, status="offered")

    waiting_resident = _lookup_resident_by_id(entry["resident_id"])
    email_result = send_waitlist_offer_email(
        recipient_email=waiting_resident["email"] if waiting_resident else "",
        space_id=space_id,
        visitor_name=entry["visitor_name"],
        visitor_plate=entry["visitor_plate"],
        start_time=entry["start_time"],
        end_time=entry["end_time"],
    )

    return {
        "waitlist_id": waitlist_id,
        "space_id": space_id,
        "visitor_name": entry["visitor_name"],
        "offer_email_sent": email_result.get("success", False),
    }


def get_waitlist_offers(session_id: str) -> dict:
    """Returns currently-offered waitlist entries for the resident identified in this
    browser session — used by GET /api/waitlist/offers. Plain function, not a Strands
    tool: React polls this directly, no LLM involvement in reading state. Takes
    session_id directly (rather than the implicit "current session" the chat flow
    uses) since this is a plain GET with no agent turn to set it."""
    resident = _SESSIONS.get(session_id, {}).get("resident")
    if resident is None:
        return {"offers": []}
    entries = _repo.get_waitlist_entries()
    offers = [
        {
            "waitlist_id": e["waitlist_id"],
            "space_id": e["offered_space_id"],
            "visitor_name": e["visitor_name"],
            "visitor_plate": e["visitor_plate"],
            "start_time": e["start_time"],
            "end_time": e["end_time"],
            "status": e["status"],
        }
        for e in entries
        if e["resident_id"] == resident["resident_id"] and e["status"] == "offered"
    ]
    return {"offers": offers}


def accept_waitlist_offer(waitlist_id: str, tz_name: str | None = None) -> dict:
    """Deterministic UI action (Accept button) — plain function, not a Strands tool.
    Rechecks everything against persisted state before creating a real permit.

    tz_name (the accepting resident's browser-reported IANA timezone) is used only
    to display the booking's date/time in the confirmation emails; it plays no role
    in the acceptance logic itself.
    """
    entry = _repo.get_waitlist_entry(waitlist_id)
    if entry is None:
        return {"error": "not_found", "message": f"No waitlist entry found with id {waitlist_id}."}

    if entry["status"] != "offered":
        return {
            "success": True,
            "already_finalized": True,
            "waitlist_id": waitlist_id,
            "status": entry["status"],
            "message": f"Waitlist entry {waitlist_id} is already {entry['status']}.",
        }

    if _is_past(entry["end_time"]):
        return {"error": f"The requested end time {entry['end_time']} has already passed."}

    space_id = entry["offered_space_id"]
    permit_id = f"SP-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.now(timezone.utc).isoformat()
    new_permit = {
        "permit_id": permit_id,
        "resident_id": entry["resident_id"],
        "visitor_name": entry["visitor_name"],
        "visitor_plate": entry["visitor_plate"].upper(),
        "space_id": space_id,
        "start_time": entry["start_time"],
        "end_time": entry["end_time"],
        "status": "upcoming",
        "permit_type": entry["request_type"],
        "reason": "",
        "created_at": now,
    }

    # Atomic: waitlist offered->accepted, space offered->reserved, and the new
    # permit row all happen together, or not at all — a plain sequential version
    # (update waitlist, then separately reserve the space) could leave the waitlist
    # entry "accepted" with no permit ever created if a later step failed.
    accepted_permit = _repo.accept_waitlist_offer_and_add_permit(waitlist_id, space_id, new_permit)
    if accepted_permit is None:
        current = _repo.get_waitlist_entry(waitlist_id) or entry
        return {
            "success": True,
            "already_finalized": True,
            "waitlist_id": waitlist_id,
            "status": current["status"],
            "message": f"Waitlist entry {waitlist_id} is already {current['status']}.",
        }

    spaces = _repo.get_spaces()
    meta = {
        "remaining_available_spaces": [r["space_id"] for r in spaces if r["status"] == "available"],
        "total_spaces": len(spaces),
    }

    accepting_resident = _lookup_resident_by_id(entry["resident_id"])
    resident_email = send_permit_confirmation_email(
        recipient_email=accepting_resident["email"] if accepting_resident else "",
        permit_id=new_permit["permit_id"],
        visitor_name=entry["visitor_name"],
        visitor_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=entry["start_time"],
        end_time=entry["end_time"],
        available_spaces=len(meta["remaining_available_spaces"]),
        total_spaces=meta["total_spaces"],
        tz_name=tz_name,
    )
    admin_email = send_visitor_admin_notification(
        recipient_email=os.environ.get("SPOTON_SECURITY_EMAIL", ""),
        permit_id=new_permit["permit_id"],
        resident_unit=accepting_resident["unit_number"] if accepting_resident else "",
        visitor_name=entry["visitor_name"],
        visitor_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=entry["start_time"],
        end_time=entry["end_time"],
        tz_name=tz_name,
    )

    return {
        "success": True,
        "waitlist_id": waitlist_id,
        "status": "accepted",
        "permit_id": new_permit["permit_id"],
        "space_id": new_permit["space_id"],
        "visitor_name": entry["visitor_name"],
        "visitor_plate": new_permit["visitor_plate"],
        "start_time": entry["start_time"],
        "end_time": entry["end_time"],
        "resident_email_sent": resident_email.get("success", False),
        "admin_email_sent": admin_email.get("success", False),
        "message": f"Parking space {new_permit['space_id']} has been confirmed.",
    }


def decline_waitlist_offer(waitlist_id: str) -> dict:
    """Deterministic UI action (Decline button) — plain function, not a Strands tool."""
    entry = _repo.get_waitlist_entry(waitlist_id)
    if entry is None:
        return {"error": "not_found", "message": f"No waitlist entry found with id {waitlist_id}."}

    if entry["status"] != "offered":
        return {
            "success": True,
            "already_finalized": True,
            "waitlist_id": waitlist_id,
            "status": entry["status"],
            "message": f"Waitlist entry {waitlist_id} is already {entry['status']}.",
        }

    space_id = entry["offered_space_id"]
    _repo.update_waitlist_entry(waitlist_id, status="declined")

    space = _repo.get_space(space_id)
    if space is not None and space["status"] == "offered":
        _repo.update_space(space_id, status="available")

    return {
        "success": True,
        "waitlist_id": waitlist_id,
        "status": "declined",
        "space_id": space_id,
        "space_status": "available",
        "message": f"Offer for space {space_id} has been declined; the space is available again.",
    }
