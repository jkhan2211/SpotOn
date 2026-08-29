import csv
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from strands import tool
from services.email_service import (
    send_permit_confirmation_email,
    send_temp_resident_confirmation_email,
    send_temp_resident_admin_notification,
)

load_dotenv(Path(__file__).parent.parent / ".env")

# shared dict populated by create_permit() / create_temporary_resident_permit(), read by main.py after agent call
last_created_permit: dict = {}

_BASE = Path(__file__).parent.parent.parent / "mock_data"
SPACES_CSV = _BASE / "parking_spaces.csv"
PERMITS_CSV = _BASE / "permits.csv"
RESIDENTS_CSV = _BASE / "residents.csv"
VEHICLES_CSV = _BASE / "vehicles.csv"

# permits.csv column order — fixed so every write has the same shape regardless
# of which permit_type triggered it (visitor rows just get an empty "reason").
PERMIT_FIELDNAMES = [
    "permit_id", "resident_id", "visitor_name", "visitor_plate", "space_id",
    "start_time", "end_time", "status", "permit_type", "reason", "created_at",
]

# No login/session in this prototype — the frontend assumes a single demo
# resident identified by unit number (see src/resident/residentData.js CURRENT_RESIDENT).
DEMO_RESIDENT_UNIT = "14"


def _read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _write_csv(path, rows, fieldnames):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def _get_demo_resident() -> dict | None:
    residents = _read_csv(RESIDENTS_CSV)
    row = next((r for r in residents if r["unit_number"] == DEMO_RESIDENT_UNIT), None)
    if row is None:
        return None
    return {
        "resident_id": row["resident_id"],
        "name": f'{row["first_name"]} {row["last_name"]}',
        "email": row["email"],
        "unit_number": row["unit_number"],
    }


def _get_active_vehicles(resident_id: str) -> list[dict]:
    vehicles = _read_csv(VEHICLES_CSV)
    return [
        {"plate": v["plate"], "make": v["make"], "model": v["model"]}
        for v in vehicles
        if v["resident_id"] == resident_id and v["status"] == "active"
    ]


def _assign_space_and_create_permit(
    resident_id: str, occupant_name: str, plate: str,
    start_time: str, end_time: str, permit_type: str, reason: str,
) -> tuple[dict | None, dict]:
    """Shared by visitor and temporary-resident bookings: assigns the first available
    space and persists the permit. Returns (permit_row, meta) or (None, error_dict)."""
    spaces = _read_csv(SPACES_CSV)
    available = [r for r in spaces if r["status"] == "available"]
    if not available:
        return None, {"error": "No parking spaces are currently available."}

    space = available[0]
    permit_id = f"SP-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.now(timezone.utc).isoformat()

    for r in spaces:
        if r["space_id"] == space["space_id"]:
            r["status"] = "reserved"
            r["current_permit_id"] = permit_id
    _write_csv(SPACES_CSV, spaces, ["space_id", "space_type", "status", "current_permit_id"])

    permits = _read_csv(PERMITS_CSV)
    new_permit = {
        "permit_id": permit_id,
        "resident_id": resident_id,
        "visitor_name": occupant_name,
        "visitor_plate": plate.upper(),
        "space_id": space["space_id"],
        "start_time": start_time,
        "end_time": end_time,
        "status": "upcoming",
        "permit_type": permit_type,
        "reason": reason,
        "created_at": now,
    }
    permits.append(new_permit)
    _write_csv(PERMITS_CSV, permits, PERMIT_FIELDNAMES)

    remaining = [r["space_id"] for r in spaces if r["status"] == "available"]
    return new_permit, {"remaining_available_spaces": remaining, "total_spaces": len(spaces)}


@tool
def check_parking_availability() -> dict:
    """
    Check current visitor parking availability from the community parking data.

    Returns:
        dict: Available spaces list, occupied count, and total count.
    """
    rows = _read_csv(SPACES_CSV)
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
        dict: Created permit details including permit_id and assigned space_id, or an error.
    """
    new_permit, meta = _assign_space_and_create_permit(
        resident_id="14",
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

    last_created_permit.clear()
    last_created_permit.update(result)

    send_permit_confirmation_email(
        recipient_email=os.environ.get("SPOTON_RECIPIENT_EMAIL", ""),
        permit_id=new_permit["permit_id"],
        visitor_name=visitor_name,
        visitor_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=start_time,
        end_time=end_time,
        available_spaces=len(meta["remaining_available_spaces"]),
        total_spaces=meta["total_spaces"],
    )

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
        (each with plate, make, model), or an error if no demo resident record is found.
    """
    resident = _get_demo_resident()
    if resident is None:
        return {"error": "No resident record found for the current session."}
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
        registered vehicles or no spaces are currently available.
    """
    resident = _get_demo_resident()
    if resident is None:
        return {"error": "No resident record found for the current session."}

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

    last_created_permit.clear()
    last_created_permit.update(result)

    resident_email = send_temp_resident_confirmation_email(
        recipient_email=os.environ.get("SPOTON_RECIPIENT_EMAIL", ""),
        permit_id=new_permit["permit_id"],
        vehicle_plate=new_permit["visitor_plate"],
        space_id=new_permit["space_id"],
        start_time=start_time,
        end_time=end_time,
        reason=reason,
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
    )

    result["resident_email_sent"] = resident_email.get("success", False)
    result["admin_email_sent"] = admin_email.get("success", False)
    return result
