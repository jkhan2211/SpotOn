"""Returns the Repository implementation selected by SPOTON_DATA_BACKEND.

Today only "csv" (the default) is implemented. Any other value fails loudly
and immediately rather than silently falling back to CSV — a future
DynamoDBRepository plugs in here as a second branch, with no changes needed
anywhere else in the app.
"""

import os

from repositories.base_repository import Repository
from repositories.csv_repository import CsvRepository

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
        raise NotImplementedError(
            "SPOTON_DATA_BACKEND=dynamodb is not implemented yet. "
            "DynamoDBRepository does not exist in this codebase — only 'csv' "
            "is currently supported. See the DynamoDB readiness report for "
            "what a future DynamoDBRepository needs to implement."
        )

    raise ValueError(
        f"Unsupported SPOTON_DATA_BACKEND={backend!r}. Supported values: 'csv'."
    )
