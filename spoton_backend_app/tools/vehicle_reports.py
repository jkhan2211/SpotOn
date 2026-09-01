"""Admin/Security "unknown vehicle" report workflow.

A human (Admin/Security) physically observes a vehicle and reports it through the
admin chat — SpotOn never detects vehicles itself (no cameras/LPR/IoT). SpotOn's job
is to understand the report, run deterministic record checks, and explain the result.
It never decides a vehicle is illegal, issues a ticket, or contacts security on its
own — those are explicit human choices (Mark as Expected / Report to Security).
"""

import os
import uuid
from datetime import datetime, timezone
from strands import tool
from repositories import get_repository
from services.email_service import send_vehicle_review_notification

# All persistence goes through this — CSV today, pluggable later (see
# repositories/). Business logic below never touches a CSV path directly.
_repo = get_repository()


def normalize_plate(plate: str) -> str:
    """Deterministic plate normalization — 'abc 123', 'ABC123', 'abc123' all compare
    equal. Never left to the LLM's own string matching."""
    return "".join((plate or "").split()).upper()


def _lookup_resident_vehicle(plate_norm: str) -> dict | None:
    vehicle = _repo.get_active_vehicle_by_plate(plate_norm)
    if vehicle is None:
        return None
    resident = _repo.get_resident_by_id(vehicle["resident_id"])
    return {
        "resident_id": vehicle["resident_id"],
        "unit_number": resident["unit_number"] if resident else None,
        "make": vehicle["make"],
        "model": vehicle["model"],
    }


def _lookup_active_permit(plate_norm: str, permit_type: str) -> dict | None:
    """A permit only counts as a match if it's upcoming AND its window covers right
    now — an unstarted or already-finished permit doesn't explain a vehicle sitting
    there this moment."""
    permits = _repo.get_permits()
    now = datetime.now(timezone.utc)
    for p in permits:
        if p["permit_type"] != permit_type or p["status"] != "upcoming":
            continue
        if normalize_plate(p["visitor_plate"]) != plate_norm:
            continue
        try:
            start = datetime.fromisoformat(p["start_time"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(p["end_time"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue
        if start <= now <= end:
            return p
    return None


@tool
def report_and_check_vehicle(space_id: str, plate: str) -> dict:
    """
    Record a human-observed vehicle report and deterministically check it against
    community records. Call this whenever an Admin/Security user reports seeing an
    unrecognized or unverified vehicle in a space — extract the space id and licence
    plate from however they phrase it.

    This tool ONLY records the observation and looks up records — it never decides a
    vehicle is illegal, issues a ticket, recommends towing, or contacts security. If no
    match is found, explain that plainly as "couldn't verify against current records",
    never as an accusation (never say illegal/trespassing/intruder/violation/unauthorized
    person). The human Admin decides next steps (Mark as Expected / Report to Security)
    through the UI, not through you.

    Args:
        space_id: The parking space where the vehicle was observed (e.g. "V08").
        plate: The licence plate as reported, in any casing/spacing.

    Returns:
        dict: report_id, resident_match/visitor_permit_match/temporary_permit_match
        (booleans), status ("matched" or "requires_review"), and reasoning (list of
        plain-language strings) — all determined by deterministic lookups, not by you.
    """
    plate_norm = normalize_plate(plate)
    space_id = (space_id or "").strip().upper()
    now = datetime.now(timezone.utc)
    report_id = f"UV-{uuid.uuid4().hex[:6].upper()}"

    resident = _lookup_resident_vehicle(plate_norm)
    visitor_permit = _lookup_active_permit(plate_norm, "visitor")
    temp_permit = _lookup_active_permit(plate_norm, "temporary_resident")

    resident_match = resident is not None
    visitor_permit_match = visitor_permit is not None
    temporary_permit_match = temp_permit is not None

    reasoning = []
    if resident_match:
        reasoning.append(f"Plate matches a registered resident vehicle (Unit {resident['unit_number']}).")
    else:
        reasoning.append("No registered resident vehicle found.")

    if visitor_permit_match:
        note = f"Active visitor permit {visitor_permit['permit_id']} covers this plate"
        if visitor_permit["space_id"] != space_id:
            note += f" (registered for space {visitor_permit['space_id']}, observed in {space_id})"
        reasoning.append(note + ".")
    else:
        reasoning.append("No active visitor permit found.")

    if temporary_permit_match:
        note = f"Active temporary resident permit {temp_permit['permit_id']} covers this plate"
        if temp_permit["space_id"] != space_id:
            note += f" (registered for space {temp_permit['space_id']}, observed in {space_id})"
        reasoning.append(note + ".")
    else:
        reasoning.append("No active temporary resident parking permit found.")

    status = "matched" if (resident_match or visitor_permit_match or temporary_permit_match) else "requires_review"

    row = {
        "report_id": report_id,
        "space_id": space_id,
        "plate": plate_norm,
        "status": status,
        "resident_match": str(resident_match),
        "visitor_permit_match": str(visitor_permit_match),
        "temporary_permit_match": str(temporary_permit_match),
        "reasoning": " | ".join(reasoning),
        "reported_at": now.isoformat(),
        "reviewed_at": "",
        "review_decision": "",
        "security_notified_at": "",
    }
    _repo.add_vehicle_report(row)

    # A human just said a vehicle is physically sitting there — that's true regardless
    # of whether records explain it, so the space stops looking available. If it's
    # already reserved/offered (a legitimate permit already accounts for it), leave
    # that as-is rather than downgrading a more specific state.
    space = _repo.get_space(space_id)
    if space is not None and space["status"] == "available":
        _repo.update_space(space_id, status="unknown")

    return {
        "report_id": report_id,
        "space_id": space_id,
        "plate": plate_norm,
        "resident_match": resident_match,
        "resident_unit": resident["unit_number"] if resident else None,
        "visitor_permit_match": visitor_permit_match,
        "temporary_permit_match": temporary_permit_match,
        "status": status,
        "reasoning": reasoning,
    }


def get_vehicle_reports() -> dict:
    """Plain function for GET /api/admin/vehicle-reports — no LLM involvement in
    reading state."""
    return {"reports": _repo.get_vehicle_reports()}


def mark_expected(report_id: str) -> dict:
    """Deterministic UI action (Mark as Expected button) — plain function, not a
    Strands tool. Pure human acknowledgement: does not touch the space, does not
    create a permit or vehicle record, does not notify anyone."""
    report = _repo.get_vehicle_report(report_id)
    if report is None:
        return {"error": "not_found", "message": f"No vehicle report found with id {report_id}."}

    if report["status"] not in ("requires_review", "matched"):
        return {
            "success": True,
            "already_finalized": True,
            "report_id": report_id,
            "status": report["status"],
            "message": f"Report {report_id} is already {report['status']}.",
        }

    now = datetime.now(timezone.utc).isoformat()
    _repo.update_vehicle_report(report_id, status="expected", review_decision="expected", reviewed_at=now)

    return {"success": True, "report_id": report_id, "status": "expected", "message": "Marked as expected."}


def notify_security(report_id: str) -> dict:
    """Deterministic UI action (Report to Security button) — plain function, not a
    Strands tool. Only runs because a human explicitly chose it."""
    report = _repo.get_vehicle_report(report_id)
    if report is None:
        return {"error": "not_found", "message": f"No vehicle report found with id {report_id}."}

    if report["status"] not in ("requires_review", "matched"):
        return {
            "success": True,
            "already_finalized": True,
            "report_id": report_id,
            "status": report["status"],
            "message": f"Report {report_id} is already {report['status']}.",
        }

    now = datetime.now(timezone.utc).isoformat()
    _repo.update_vehicle_report(
        report_id,
        status="security_notified",
        review_decision="security_notified",
        reviewed_at=now,
        security_notified_at=now,
    )

    email_result = send_vehicle_review_notification(
        recipient_email=os.environ.get("SPOTON_SECURITY_EMAIL", ""),
        space_id=report["space_id"],
        plate=report["plate"],
        reported_at=report["reported_at"],
        reasoning=report["reasoning"].split(" | "),
    )

    return {
        "success": True,
        "report_id": report_id,
        "status": "security_notified",
        "security_email_sent": email_result.get("success", False),
        "message": (
            "Report saved and security notified."
            if email_result.get("success")
            else "The vehicle report was saved, but the security notification email could not be sent."
        ),
    }
