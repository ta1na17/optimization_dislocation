from typing import Any

from pydantic import BaseModel


class DroppedRow(BaseModel):
    file_name: str
    sheet_name: str | None = None
    row_number: int | None = None
    row_preview: str
    reason: str


class BuildResult(BaseModel):
    duplicates_count: int
    dropped_rows_count: int
    dropped_rows: list[DroppedRow]
    result_id: str


class NormalizedRow(BaseModel):
    wagon: str
    wagon_type: str | None = None
    payload: str | None = None
    operation_station: str | None = None
    destination_station: str | None = None
    distance_km: float | None = None
    idle_days: int | None = None
    operation: str | None = None
    owner: str | None = None
    source_file: str
    source_sheet: str | None = None
    source_row_number: int | None = None
    extra: dict[str, Any] = {}
