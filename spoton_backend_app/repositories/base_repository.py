"""Abstract persistence contract for SpotOn.

FastAPI routes and Strands tools depend on this interface, not on any concrete
storage technology. CsvRepository is today's implementation; a future
DynamoDBRepository can implement the same contract without either caller
needing to change.

These methods mirror the application's ACTUAL access patterns (see the
CSV-access inventory produced alongside this refactor) — this is not a
generic ORM, and there is no create/update for residents or vehicles because
nothing in the app ever writes to those two entities today.

Business rules (idempotency guards, waitlist FIFO matching, space-assignment
strategy, disambiguation, etc.) deliberately stay OUT of the repository and
in tools/parking_tools.py and tools/vehicle_reports.py — the repository's job
is only to fetch and persist rows, not to decide what they mean.
"""

from abc import ABC, abstractmethod


class Repository(ABC):
    # ── Residents (read-only — nothing in the app writes residents.csv) ────
    @abstractmethod
    def get_residents_by_unit(self, unit_number: str) -> list[dict]:
        """All resident rows registered to a given unit number (0, 1, or more).
        Disambiguation (first_name, active/enabled checks) is caller business
        logic, not filtered here."""

    @abstractmethod
    def get_resident_by_id(self, resident_id: str) -> dict | None:
        """A single resident's record by id, or None if not found."""

    # ── Vehicles (read-only — nothing in the app writes vehicles.csv) ──────
    @abstractmethod
    def get_active_vehicles_by_resident(self, resident_id: str) -> list[dict]:
        """A resident's active (status == "active") registered vehicles."""

    @abstractmethod
    def get_active_vehicle_by_plate(self, plate_norm: str) -> dict | None:
        """The active vehicle whose plate matches plate_norm (already
        normalized by the caller: whitespace stripped, uppercased), or None."""

    # ── Parking spaces ──────────────────────────────────────────────────────
    @abstractmethod
    def get_spaces(self) -> list[dict]:
        """Every parking space row."""

    @abstractmethod
    def get_space(self, space_id: str) -> dict | None:
        """A single space's current row by id, or None if not found."""

    @abstractmethod
    def update_space(self, space_id: str, **fields) -> dict | None:
        """Partially update a space's fields (e.g. status, current_permit_id).
        No-op if space_id doesn't exist. Returns the updated row, or None."""

    # ── Permits ─────────────────────────────────────────────────────────────
    @abstractmethod
    def get_permits(self) -> list[dict]:
        """Every permit row."""

    @abstractmethod
    def get_permit(self, permit_id: str) -> dict | None:
        """A single permit's row by id, or None if not found."""

    @abstractmethod
    def add_permit(self, permit: dict) -> None:
        """Persist a newly created permit row."""

    @abstractmethod
    def update_permit(self, permit_id: str, **fields) -> dict | None:
        """Partially update a permit's fields. No-op if not found."""

    # ── Waitlist ────────────────────────────────────────────────────────────
    @abstractmethod
    def get_waitlist_entries(self) -> list[dict]:
        """Every waitlist row."""

    @abstractmethod
    def get_waitlist_entry(self, waitlist_id: str) -> dict | None:
        """A single waitlist entry by id, or None if not found."""

    @abstractmethod
    def add_waitlist_entry(self, entry: dict) -> None:
        """Persist a newly created waitlist row."""

    @abstractmethod
    def update_waitlist_entry(self, waitlist_id: str, **fields) -> dict | None:
        """Partially update a waitlist entry's fields. No-op if not found."""

    # ── Unknown vehicle reports ─────────────────────────────────────────────
    @abstractmethod
    def get_vehicle_reports(self) -> list[dict]:
        """Every unknown-vehicle report row."""

    @abstractmethod
    def get_vehicle_report(self, report_id: str) -> dict | None:
        """A single report by id, or None if not found."""

    @abstractmethod
    def add_vehicle_report(self, report: dict) -> None:
        """Persist a newly created report row."""

    @abstractmethod
    def update_vehicle_report(self, report_id: str, **fields) -> dict | None:
        """Partially update a report's fields. No-op if not found."""
