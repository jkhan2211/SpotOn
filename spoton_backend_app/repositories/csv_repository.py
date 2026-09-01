"""CSV-backed implementation of the Repository contract.

This is today's persistence layer for SpotOn. It reuses the exact CSV files,
column order, and read/write behaviour that predate this refactor — no schema
changes, no data migration. A future DynamoDBRepository implements the same
Repository interface (see base_repository.py) and can replace this class
without FastAPI routes, Strands tools, or business logic knowing anything
changed.
"""

import csv
from pathlib import Path

from repositories.base_repository import Repository

_BASE = Path(__file__).parent.parent.parent / "mock_data"

SPACES_CSV = _BASE / "parking_spaces.csv"
PERMITS_CSV = _BASE / "permits.csv"
RESIDENTS_CSV = _BASE / "residents.csv"
VEHICLES_CSV = _BASE / "vehicles.csv"
WAITLIST_CSV = _BASE / "waitlist.csv"
UNKNOWN_VEHICLE_CSV = _BASE / "unknown_vehicle.csv"

# Column order for every CSV this app writes to. Residents and vehicles have
# no fieldnames here because nothing in the app ever writes those two files.
SPACE_FIELDNAMES = ["space_id", "space_type", "status", "current_permit_id"]

PERMIT_FIELDNAMES = [
    "permit_id", "resident_id", "visitor_name", "visitor_plate", "space_id",
    "start_time", "end_time", "status", "permit_type", "reason", "created_at",
]

WAITLIST_FIELDNAMES = [
    "waitlist_id", "resident_id", "request_type", "visitor_name", "visitor_plate",
    "start_time", "end_time", "status", "offered_space_id", "offered_at", "permit_id", "created_at",
]

UNKNOWN_VEHICLE_FIELDNAMES = [
    "report_id", "space_id", "plate", "status", "resident_match", "visitor_permit_match",
    "temporary_permit_match", "reasoning", "reported_at", "reviewed_at", "review_decision",
    "security_notified_at",
]


def _read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def _find_by_id(path: Path, id_field: str, id_value: str) -> dict | None:
    return next((r for r in _read_csv(path) if r[id_field] == id_value), None)


def _update_by_id(path: Path, fieldnames: list[str], id_field: str, id_value: str, fields: dict) -> dict | None:
    """Read-modify-write a single row by id — the same pattern every mutating
    tool in the old code duplicated by hand. No-op (returns None) if id_value
    doesn't exist, matching prior behaviour exactly (callers already validate
    existence before calling this)."""
    rows = _read_csv(path)
    updated = None
    for row in rows:
        if row[id_field] == id_value:
            row.update(fields)
            updated = row
    if updated is not None:
        _write_csv(path, rows, fieldnames)
    return updated


class CsvRepository(Repository):
    # ── Residents ────────────────────────────────────────────────────────────
    def get_residents_by_unit(self, unit_number: str) -> list[dict]:
        return [r for r in _read_csv(RESIDENTS_CSV) if r["unit_number"] == unit_number]

    def get_resident_by_id(self, resident_id: str) -> dict | None:
        return _find_by_id(RESIDENTS_CSV, "resident_id", resident_id)

    # ── Vehicles ─────────────────────────────────────────────────────────────
    def get_active_vehicles_by_resident(self, resident_id: str) -> list[dict]:
        return [
            v for v in _read_csv(VEHICLES_CSV)
            if v["resident_id"] == resident_id and v["status"] == "active"
        ]

    def get_active_vehicle_by_plate(self, plate_norm: str) -> dict | None:
        # Mirrors tools.vehicle_reports.normalize_plate's whitespace/casing
        # normalization inline, deliberately, so this data-access layer doesn't
        # import business-logic code from the tools layer.
        def _norm(plate: str) -> str:
            return "".join((plate or "").split()).upper()

        return next(
            (v for v in _read_csv(VEHICLES_CSV) if v["status"] == "active" and _norm(v["plate"]) == plate_norm),
            None,
        )

    # ── Parking spaces ───────────────────────────────────────────────────────
    def get_spaces(self) -> list[dict]:
        return _read_csv(SPACES_CSV)

    def get_space(self, space_id: str) -> dict | None:
        return _find_by_id(SPACES_CSV, "space_id", space_id)

    def update_space(self, space_id: str, **fields) -> dict | None:
        return _update_by_id(SPACES_CSV, SPACE_FIELDNAMES, "space_id", space_id, fields)

    # ── Permits ──────────────────────────────────────────────────────────────
    def get_permits(self) -> list[dict]:
        return _read_csv(PERMITS_CSV)

    def get_permit(self, permit_id: str) -> dict | None:
        return _find_by_id(PERMITS_CSV, "permit_id", permit_id)

    def add_permit(self, permit: dict) -> None:
        permits = _read_csv(PERMITS_CSV)
        permits.append(permit)
        _write_csv(PERMITS_CSV, permits, PERMIT_FIELDNAMES)

    def update_permit(self, permit_id: str, **fields) -> dict | None:
        return _update_by_id(PERMITS_CSV, PERMIT_FIELDNAMES, "permit_id", permit_id, fields)

    # ── Waitlist ─────────────────────────────────────────────────────────────
    def get_waitlist_entries(self) -> list[dict]:
        return _read_csv(WAITLIST_CSV)

    def get_waitlist_entry(self, waitlist_id: str) -> dict | None:
        return _find_by_id(WAITLIST_CSV, "waitlist_id", waitlist_id)

    def add_waitlist_entry(self, entry: dict) -> None:
        entries = _read_csv(WAITLIST_CSV)
        entries.append(entry)
        _write_csv(WAITLIST_CSV, entries, WAITLIST_FIELDNAMES)

    def update_waitlist_entry(self, waitlist_id: str, **fields) -> dict | None:
        return _update_by_id(WAITLIST_CSV, WAITLIST_FIELDNAMES, "waitlist_id", waitlist_id, fields)

    # ── Unknown vehicle reports ──────────────────────────────────────────────
    def get_vehicle_reports(self) -> list[dict]:
        return _read_csv(UNKNOWN_VEHICLE_CSV)

    def get_vehicle_report(self, report_id: str) -> dict | None:
        return _find_by_id(UNKNOWN_VEHICLE_CSV, "report_id", report_id)

    def add_vehicle_report(self, report: dict) -> None:
        reports = _read_csv(UNKNOWN_VEHICLE_CSV)
        reports.append(report)
        _write_csv(UNKNOWN_VEHICLE_CSV, reports, UNKNOWN_VEHICLE_FIELDNAMES)

    def update_vehicle_report(self, report_id: str, **fields) -> dict | None:
        return _update_by_id(UNKNOWN_VEHICLE_CSV, UNKNOWN_VEHICLE_FIELDNAMES, "report_id", report_id, fields)
