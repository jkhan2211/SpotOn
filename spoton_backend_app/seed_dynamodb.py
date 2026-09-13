"""One-time script: load SpotOn's demo CSV data into DynamoDB.

Reads the same six files under mock_data/ that CsvRepository reads, and
writes each row as-is into the matching DynamoDB table (same resident_id,
vehicle_id, space_id, permit_id, waitlist_id, report_id — no renumbering, no
transformation, no dropped fields). It does not touch React, FastAPI, or
Strands, and it never sends email.

This is independent of SPOTON_DATA_BACKEND — it always writes to DynamoDB
directly, regardless of which backend the app is currently configured to
read from, so you can seed ahead of flipping the switch.

Idempotency — what happens if you run this twice:
  Every write is an unconditional put_item, keyed by the same id the CSV row
  already has. Running it again just overwrites each item with the exact same
  data it already contains — a no-op in effect, not a duplicate. It is NOT
  additive; you cannot double a table's row count by re-running this.
  It also does NOT delete anything: if a table already has rows with ids that
  no longer appear in the CSV (or you've hand-edited an item's fields directly
  in the DynamoDB console), those are left untouched — this script only ever
  writes rows that exist in the CSVs today, it never wipes a table first.

No real resident PII: the demo residents.csv already uses only synthetic
names paired with the project owner's own +alias Gmail addresses for SES
testing — nothing here is a real third party's data.
"""

import csv
import os
from pathlib import Path

import boto3
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

_BASE = Path(__file__).parent.parent / "mock_data"
_dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION", "us-east-1"))

# (csv filename, table-name env var, default table name)
SEED_TARGETS = [
    ("residents.csv", "SPOTON_RESIDENTS_TABLE", "spoton-residents"),
    ("vehicles.csv", "SPOTON_VEHICLES_TABLE", "spoton-vehicles"),
    ("parking_spaces.csv", "SPOTON_SPACES_TABLE", "spoton-spaces"),
    ("permits.csv", "SPOTON_PERMITS_TABLE", "spoton-permits"),
    ("waitlist.csv", "SPOTON_WAITLIST_TABLE", "spoton-waitlist"),
    ("unknown_vehicle.csv", "SPOTON_VEHICLE_REPORTS_TABLE", "spoton-vehicle-reports"),
]


def _read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def seed_table(csv_filename: str, table_name_env: str, default_table_name: str) -> None:
    csv_path = _BASE / csv_filename
    table_name = os.environ.get(table_name_env, default_table_name)
    table = _dynamodb.Table(table_name)

    rows = _read_csv(csv_path)
    if not rows:
        print(f"  {csv_filename:22s} -> {table_name:26s}  0 rows (file is empty, nothing to seed)")
        return

    for row in rows:
        table.put_item(Item=row)

    print(f"  {csv_filename:22s} -> {table_name:26s}  {len(rows)} row(s) written")


def main() -> None:
    print("Seeding DynamoDB from mock_data/*.csv")
    print(f"Region: {os.environ.get('AWS_REGION', 'us-east-1')}  Profile: {os.environ.get('AWS_PROFILE', '(default chain)')}")
    print()
    for csv_filename, table_env, default_table in SEED_TARGETS:
        seed_table(csv_filename, table_env, default_table)
    print()
    print("Done. Re-running this script is safe — it overwrites existing rows with")
    print("identical data (same ids), it does not duplicate or delete anything.")


if __name__ == "__main__":
    main()
