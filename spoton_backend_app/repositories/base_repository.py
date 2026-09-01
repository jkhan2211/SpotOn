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

    # ── Multi-item atomic operations ────────────────────────────────────────
    # These exist because their two-or-three-row updates must succeed or fail
    # together — see the Phase 2/8 migration notes for why each one is a race
    # risk otherwise. CsvRepository implements them as the same sequential
    # calls the tools layer used to make directly (CSV has no real concurrent
    # writers); DynamoDBRepository implements them as a single
    # TransactWriteItems call guarded by ConditionExpressions.
    @abstractmethod
    def reserve_space_and_add_permit(self, space_id: str, required_status: str, permit: dict) -> dict | None:
        """Atomically move a space from required_status ("available" for a
        fresh booking, "offered" for a waitlist-offer acceptance) to
        "reserved" (linked to permit["permit_id"]), and persist the new
        permit row. Returns the permit dict on success, or None if the space
        was no longer in required_status (lost a race, or a stale offer)."""

    @abstractmethod
    def release_permit_and_free_space(self, permit_id: str, space_id: str) -> dict | None:
        """Atomically move a permit from "upcoming" to "released" and, if the
        space is still linked to this permit, free it back to "available".
        Returns the updated permit dict on success, or None if the permit was
        already not "upcoming" (idempotent no-op — someone else released it
        first)."""

    @abstractmethod
    def accept_waitlist_offer_and_add_permit(self, waitlist_id: str, space_id: str, permit: dict) -> dict | None:
        """Atomically move a waitlist entry from "offered" to "accepted"
        (recording permit["permit_id"]), move its offered space from
        "offered" to "reserved", and persist the new permit row. Returns the
        permit dict on success, or None if the offer was no longer "offered"
        (lost a race — already accepted or declined elsewhere)."""

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
