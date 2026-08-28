import csv
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from strands import tool
from services.email_service import send_permit_confirmation_email

load_dotenv(Path(__file__).parent.parent / ".env")

# shared dict populated by create_permit(), read by main.py after agent call
last_created_permit: dict = {}

_BASE = Path(__file__).parent.parent.parent / "mock_data"
SPACES_CSV = _BASE / "parking_spaces.csv"
PERMITS_CSV = _BASE / "permits.csv"


def _read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _write_csv(path, rows, fieldnames):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


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
    spaces = _read_csv(SPACES_CSV)
    available = [r for r in spaces if r["status"] == "available"]
    if not available:
        return {"error": "No visitor parking spaces are currently available."}

    space = available[0]
    permit_id = f"SP-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.now(timezone.utc).isoformat()

    # update space status
    for r in spaces:
        if r["space_id"] == space["space_id"]:
            r["status"] = "reserved"
            r["current_permit_id"] = permit_id
    _write_csv(SPACES_CSV, spaces, ["space_id", "space_type", "status", "current_permit_id"])

    # append new permit
    permits = _read_csv(PERMITS_CSV)
    new_permit = {
        "permit_id": permit_id,
        "resident_id": "14",
        "visitor_name": visitor_name,
        "visitor_plate": visitor_plate.upper(),
        "space_id": space["space_id"],
        "start_time": start_time,
        "end_time": end_time,
        "status": "upcoming",
        "permit_type": "visitor",
        "created_at": now,
    }
    permits.append(new_permit)
    _write_csv(PERMITS_CSV, permits, list(new_permit.keys()))

    remaining = [r["space_id"] for r in spaces if r["status"] == "available"]

    result = {
        "permit_id": permit_id,
        "space_id": space["space_id"],
        "visitor_name": visitor_name,
        "visitor_plate": visitor_plate.upper(),
        "start_time": start_time,
        "end_time": end_time,
        "status": "upcoming",
        "remaining_available_spaces": remaining,
    }

    last_created_permit.clear()
    last_created_permit.update(result)

    send_permit_confirmation_email(
        recipient_email=os.environ.get("SPOTON_RECIPIENT_EMAIL", ""),
        permit_id=permit_id,
        visitor_name=visitor_name,
        visitor_plate=visitor_plate.upper(),
        space_id=space["space_id"],
        start_time=start_time,
        end_time=end_time,
        available_spaces=len(remaining),
        total_spaces=len(spaces),
    )

    return result
