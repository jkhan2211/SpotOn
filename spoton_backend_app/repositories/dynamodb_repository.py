"""DynamoDB-backed implementation of the Repository contract.

Mirrors CsvRepository's behaviour exactly — same return shapes (plain dicts of
strings), same status semantics, same no-op-if-missing contract on updates —
so nothing above the repository layer (FastAPI routes, Strands tools) needs to
know which backend is active. Every attribute is stored as a DynamoDB String,
matching csv.DictReader's all-strings rows, so callers never have to deal with
Decimal or type coercion.

Table names and keys come from the Phase 2 design:
  spoton-residents        pk=resident_id
  spoton-vehicles         pk=resident_id, sk=vehicle_id
  spoton-spaces           pk=space_id
  spoton-permits          pk=permit_id
  spoton-waitlist         pk=waitlist_id
  spoton-vehicle-reports  pk=report_id

No conditional writes yet — add_*/update_* here use plain PutItem/UpdateItem,
same as CsvRepository's unconditional read-modify-write. Conditional writes
and transactions for the race-prone operations (space reservation, waitlist
accept, permit release) are a deliberate separate step, not bundled in here.
"""

import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

from repositories.base_repository import Repository

# Loaded here, not just by the modules that import us, because this module
# builds its boto3 session at import time — and repositories/ gets imported
# (via main.py -> agent -> tools.parking_tools -> repositories) before any of
# those callers' own load_dotenv() calls have necessarily run yet. Without
# this, AWS_PROFILE/AWS_REGION could still be unset when the session below is
# created, silently falling back to whatever (possibly stale) credentials
# exist in the raw shell environment instead of .env's spoton profile.
load_dotenv(Path(__file__).parent.parent / ".env")

_dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))
# TransactWriteItems isn't exposed on the resource's Table objects, only on
# the client — but for DynamoDB specifically, resource.meta.client is NOT a
# plain low-level client: boto3 attaches its high-level auto-serialization
# hooks (plain Python values <-> {"S": ...} wire format) directly to this
# client object, and those hooks fire for every call made through it,
# including client-style calls like transact_write_items. So Key/Item/
# ExpressionAttributeValues below must be plain Python values, exactly like
# Table.get_item()/put_item() already take — manually pre-serializing them
# (an earlier version of this file did, via TypeSerializer) double-serializes
# and DynamoDB rejects it ("Type mismatch ... actual: M").
_client = _dynamodb.meta.client

RESIDENTS_TABLE = os.environ.get("SPOTON_RESIDENTS_TABLE", "spoton-residents")
VEHICLES_TABLE = os.environ.get("SPOTON_VEHICLES_TABLE", "spoton-vehicles")
SPACES_TABLE = os.environ.get("SPOTON_SPACES_TABLE", "spoton-spaces")
PERMITS_TABLE = os.environ.get("SPOTON_PERMITS_TABLE", "spoton-permits")
WAITLIST_TABLE = os.environ.get("SPOTON_WAITLIST_TABLE", "spoton-waitlist")
VEHICLE_REPORTS_TABLE = os.environ.get("SPOTON_VEHICLE_REPORTS_TABLE", "spoton-vehicle-reports")


def _norm_plate(plate: str) -> str:
    # Mirrors tools.vehicle_reports.normalize_plate inline, deliberately, so
    # this data-access layer doesn't import business-logic code — same
    # rationale as CsvRepository.get_active_vehicle_by_plate.
    return "".join((plate or "").split()).upper()


def _scan_all(table, **kwargs) -> list[dict]:
    """Scan a whole table, following pagination — tables here are tiny, but a
    single Scan response is capped at 1MB and must not silently truncate."""
    items: list[dict] = []
    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items
        kwargs["ExclusiveStartKey"] = last_key


def _query_all(table, **kwargs) -> list[dict]:
    items: list[dict] = []
    while True:
        response = table.query(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items
        kwargs["ExclusiveStartKey"] = last_key


def _condition_update_action(
    table_name: str, key: dict, fields: dict,
    condition_expr: str, condition_values: dict, condition_names: dict | None = None,
) -> dict:
    """One TransactWriteItems "Update" action: SET fields, gated on
    condition_expr evaluating true against the item's *pre-update* state."""
    set_names = {f"#f{i}": k for i, k in enumerate(fields)}
    set_values = {f":v{i}": v for i, v in enumerate(fields.values())}
    set_expr = "SET " + ", ".join(f"{n} = {v}" for n, v in zip(set_names, set_values))
    return {
        "Update": {
            "TableName": table_name,
            "Key": key,
            "UpdateExpression": set_expr,
            "ConditionExpression": condition_expr,
            "ExpressionAttributeNames": {**set_names, **(condition_names or {})},
            "ExpressionAttributeValues": {**set_values, **condition_values},
        }
    }


def _put_action(table_name: str, item: dict, condition_expr: str | None = None) -> dict:
    action = {"TableName": table_name, "Item": item}
    if condition_expr:
        action["ConditionExpression"] = condition_expr
    return {"Put": action}


def _run_transaction(actions: list[dict]) -> bool:
    """True on success. False if any action's ConditionExpression failed — a
    legitimate, expected outcome (a race was lost, or an offer went stale),
    not an error. Anything else re-raises."""
    try:
        _client.transact_write_items(TransactItems=actions)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "TransactionCanceledException":
            reasons = e.response.get("CancellationReasons", [])
            if any(r.get("Code") == "ConditionalCheckFailed" for r in reasons):
                return False
        raise


def _update_item(table, key: dict, fields: dict) -> dict | None:
    """Partial update by primary key, no-op (returns None) if the item doesn't
    exist — matching CsvRepository._update_by_id's contract exactly. Fields
    dict must be non-empty (every caller here passes at least one field)."""
    names = {f"#f{i}": k for i, k in enumerate(fields)}
    values = {f":v{i}": v for i, v in enumerate(fields.values())}
    update_expr = "SET " + ", ".join(f"{name} = {values_key}" for name, values_key in zip(names, values))
    condition_expr = " AND ".join(f"attribute_exists({k})" for k in key)

    try:
        response = table.update_item(
            Key=key,
            UpdateExpression=update_expr,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression=condition_expr,
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise
    return dict(response["Attributes"])


class DynamoDBRepository(Repository):
    def __init__(self):
        self._residents = _dynamodb.Table(RESIDENTS_TABLE)
        self._vehicles = _dynamodb.Table(VEHICLES_TABLE)
        self._spaces = _dynamodb.Table(SPACES_TABLE)
        self._permits = _dynamodb.Table(PERMITS_TABLE)
        self._waitlist = _dynamodb.Table(WAITLIST_TABLE)
        self._vehicle_reports = _dynamodb.Table(VEHICLE_REPORTS_TABLE)

    # ── Residents ────────────────────────────────────────────────────────────
    def get_residents_by_unit(self, unit_number: str) -> list[dict]:
        return _scan_all(
            self._residents,
            FilterExpression="unit_number = :u",
            ExpressionAttributeValues={":u": unit_number},
        )

    def get_resident_by_id(self, resident_id: str) -> dict | None:
        item = self._residents.get_item(Key={"resident_id": resident_id}).get("Item")
        return dict(item) if item is not None else None

    # ── Vehicles ─────────────────────────────────────────────────────────────
    def get_active_vehicles_by_resident(self, resident_id: str) -> list[dict]:
        return _query_all(
            self._vehicles,
            KeyConditionExpression="resident_id = :r",
            FilterExpression="#status = :active",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":r": resident_id, ":active": "active"},
        )

    def get_active_vehicle_by_plate(self, plate_norm: str) -> dict | None:
        active = _scan_all(
            self._vehicles,
            FilterExpression="#status = :active",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":active": "active"},
        )
        return next((v for v in active if _norm_plate(v["plate"]) == plate_norm), None)

    # ── Parking spaces ───────────────────────────────────────────────────────
    def get_spaces(self) -> list[dict]:
        return _scan_all(self._spaces)

    def get_space(self, space_id: str) -> dict | None:
        item = self._spaces.get_item(Key={"space_id": space_id}).get("Item")
        return dict(item) if item is not None else None

    def update_space(self, space_id: str, **fields) -> dict | None:
        return _update_item(self._spaces, {"space_id": space_id}, fields)

    # ── Permits ──────────────────────────────────────────────────────────────
    def get_permits(self) -> list[dict]:
        return _scan_all(self._permits)

    def get_permit(self, permit_id: str) -> dict | None:
        item = self._permits.get_item(Key={"permit_id": permit_id}).get("Item")
        return dict(item) if item is not None else None

    def add_permit(self, permit: dict) -> None:
        self._permits.put_item(Item=permit)

    def update_permit(self, permit_id: str, **fields) -> dict | None:
        return _update_item(self._permits, {"permit_id": permit_id}, fields)

    # ── Waitlist ─────────────────────────────────────────────────────────────
    def get_waitlist_entries(self) -> list[dict]:
        return _scan_all(self._waitlist)

    def get_waitlist_entry(self, waitlist_id: str) -> dict | None:
        item = self._waitlist.get_item(Key={"waitlist_id": waitlist_id}).get("Item")
        return dict(item) if item is not None else None

    def add_waitlist_entry(self, entry: dict) -> None:
        self._waitlist.put_item(Item=entry)

    def update_waitlist_entry(self, waitlist_id: str, **fields) -> dict | None:
        return _update_item(self._waitlist, {"waitlist_id": waitlist_id}, fields)

    # ── Multi-item atomic operations ────────────────────────────────────────
    def reserve_space_and_add_permit(self, space_id: str, required_status: str, permit: dict) -> dict | None:
        actions = [
            _condition_update_action(
                SPACES_TABLE, {"space_id": space_id},
                {"status": "reserved", "current_permit_id": permit["permit_id"]},
                condition_expr="#status = :required",
                condition_values={":required": required_status},
                condition_names={"#status": "status"},
            ),
            _put_action(PERMITS_TABLE, permit, condition_expr="attribute_not_exists(permit_id)"),
        ]
        return permit if _run_transaction(actions) else None

    def release_permit_and_free_space(self, permit_id: str, space_id: str) -> dict | None:
        actions = [
            _condition_update_action(
                PERMITS_TABLE, {"permit_id": permit_id},
                {"status": "released"},
                condition_expr="#status = :upcoming",
                condition_values={":upcoming": "upcoming"},
                condition_names={"#status": "status"},
            ),
            _condition_update_action(
                SPACES_TABLE, {"space_id": space_id},
                {"status": "available", "current_permit_id": ""},
                condition_expr="current_permit_id = :permit_id",
                condition_values={":permit_id": permit_id},
            ),
        ]
        if not _run_transaction(actions):
            return None
        return self.get_permit(permit_id)

    def accept_waitlist_offer_and_add_permit(self, waitlist_id: str, space_id: str, permit: dict) -> dict | None:
        actions = [
            _condition_update_action(
                WAITLIST_TABLE, {"waitlist_id": waitlist_id},
                {"status": "accepted", "permit_id": permit["permit_id"]},
                condition_expr="#status = :offered",
                condition_values={":offered": "offered"},
                condition_names={"#status": "status"},
            ),
            _condition_update_action(
                SPACES_TABLE, {"space_id": space_id},
                {"status": "reserved", "current_permit_id": permit["permit_id"]},
                condition_expr="#status = :offered",
                condition_values={":offered": "offered"},
                condition_names={"#status": "status"},
            ),
            _put_action(PERMITS_TABLE, permit, condition_expr="attribute_not_exists(permit_id)"),
        ]
        return permit if _run_transaction(actions) else None

    # ── Unknown vehicle reports ──────────────────────────────────────────────
    def get_vehicle_reports(self) -> list[dict]:
        return _scan_all(self._vehicle_reports)

    def get_vehicle_report(self, report_id: str) -> dict | None:
        item = self._vehicle_reports.get_item(Key={"report_id": report_id}).get("Item")
        return dict(item) if item is not None else None

    def add_vehicle_report(self, report: dict) -> None:
        self._vehicle_reports.put_item(Item=report)

    def update_vehicle_report(self, report_id: str, **fields) -> dict | None:
        return _update_item(self._vehicle_reports, {"report_id": report_id}, fields)
