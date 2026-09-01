"""Returns the Repository implementation selected by SPOTON_DATA_BACKEND.

"csv" (the default) and "dynamodb" are both implemented and behave
identically from every caller's perspective — see repositories/csv_repository.py
and repositories/dynamodb_repository.py.
"""

import os

from repositories.base_repository import Repository
from repositories.csv_repository import CsvRepository
from repositories.dynamodb_repository import DynamoDBRepository

_repository: Repository | None = None


def get_repository() -> Repository:
    """Returns the process-wide Repository singleton, built on first call from
    SPOTON_DATA_BACKEND (default "csv")."""
    global _repository
    if _repository is None:
        _repository = _build_repository()
    return _repository


def _build_repository() -> Repository:
    backend = os.environ.get("SPOTON_DATA_BACKEND", "csv").strip().lower()

    if backend == "csv":
        return CsvRepository()

    if backend == "dynamodb":
        return DynamoDBRepository()

    raise ValueError(
        f"Unsupported SPOTON_DATA_BACKEND={backend!r}. Supported values: 'csv', 'dynamodb'."
    )
