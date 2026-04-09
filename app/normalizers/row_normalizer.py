import re
from typing import Any

import pandas as pd

from app.config.owners import OWNER_TO_TYPE
from app.models.schemas import DroppedRow, NormalizedRow
from app.normalizers.owner_normalizer import detect_owner_from_filename, detect_owner_from_text


COLUMN_ALIASES = {
    'wagon': ['вагон', 'номер вагона', 'vagon', 'wagon'],
    'wagon_type': ['тип', 'тип вагона'],
    'payload': ['г/п', 'гп', 'грузоподъемность', 'вес'],
    'operation_station': ['станция операции', 'операция станция', 'станция'],
    'destination_station': ['станция назначения', 'назначение', 'станция назначения/слива'],
    'distance_km': ['осталось, [км]', 'осталось км', 'расстояние', 'distance'],
    'idle_days': ['дни без движения', 'без движения', 'idle days'],
    'operation': ['операция', 'операция с вагоном'],
    'owner': ['собственник', 'владелец'],
    'capacity': ['кубатура', 'объем', 'вместимость'],
}


def _normalize_key(key: str) -> str:
    return re.sub(r'\s+', ' ', str(key).strip().lower())


def _find_col(cols: list[str], aliases: list[str]) -> str | None:
    mapping = {_normalize_key(c): c for c in cols}
    for alias in aliases:
        if _normalize_key(alias) in mapping:
            return mapping[_normalize_key(alias)]
    for c in cols:
        nk = _normalize_key(c)
        if any(_normalize_key(alias) in nk for alias in aliases):
            return c
    return None


def _to_float(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, str):
        value = value.replace(',', '.').strip()
    try:
        return float(value)
    except Exception:
        return None


def _to_int(value: Any) -> int | None:
    fv = _to_float(value)
    if fv is None:
        return None
    return int(round(fv))


def _infer_type(owner: str | None, explicit_type: str | None, capacity: float | None) -> str | None:
    if explicit_type:
        t = str(explicit_type).strip().upper()
        if t in {'ПВ', 'КВ'}:
            return t
    if owner and owner in OWNER_TO_TYPE:
        return OWNER_TO_TYPE[owner]
    if capacity is not None:
        if 120 <= capacity <= 161:
            return 'КВ'
        if 70 <= capacity <= 90:
            return 'ПВ'
    return None


def normalize_sheet(df: pd.DataFrame, file_name: str, sheet_name: str) -> tuple[list[NormalizedRow], list[DroppedRow]]:
    rows: list[NormalizedRow] = []
    dropped: list[DroppedRow] = []

    cols = [str(c) for c in df.columns]
    col_map = {name: _find_col(cols, aliases) for name, aliases in COLUMN_ALIASES.items()}

    for idx, raw in df.iterrows():
        row_num = int(idx) + 2
        wagon = raw.get(col_map['wagon']) if col_map['wagon'] else None
        wagon_text = '' if wagon is None or pd.isna(wagon) else str(wagon).strip()
        if not wagon_text:
            continue

        station_op = raw.get(col_map['operation_station']) if col_map['operation_station'] else None
        station_dest = raw.get(col_map['destination_station']) if col_map['destination_station'] else None
        operation = raw.get(col_map['operation']) if col_map['operation'] else None

        owner = None
        if col_map['owner']:
            owner = detect_owner_from_text(raw.get(col_map['owner']))
        if not owner:
            owner = detect_owner_from_text(*[raw.get(c) for c in cols[: min(12, len(cols))]])
        if not owner:
            owner = detect_owner_from_filename(file_name)

        payload_value = raw.get(col_map['payload']) if col_map['payload'] else None
        capacity = raw.get(col_map['capacity']) if col_map['capacity'] else None
        inferred_type = _infer_type(owner, raw.get(col_map['wagon_type']) if col_map['wagon_type'] else None, _to_float(capacity))

        minimal_values = [station_op, station_dest, operation, raw.get(col_map['distance_km']) if col_map['distance_km'] else None, raw.get(col_map['idle_days']) if col_map['idle_days'] else None]
        non_empty = [v for v in minimal_values if v is not None and not (isinstance(v, float) and pd.isna(v)) and str(v).strip()]
        if len(non_empty) == 0:
            dropped.append(DroppedRow(
                file_name=file_name,
                sheet_name=sheet_name,
                row_number=row_num,
                row_preview=f'Вагон={wagon_text}',
                reason='строка содержит только номер вагона',
            ))
            continue

        if not station_dest or (isinstance(station_dest, float) and pd.isna(station_dest)):
            dropped.append(DroppedRow(
                file_name=file_name,
                sheet_name=sheet_name,
                row_number=row_num,
                row_preview=f'Вагон={wagon_text}; Операция={operation}',
                reason='не удалось определить обязательные поля',
            ))
            continue

        rows.append(NormalizedRow(
            wagon=wagon_text,
            wagon_type=inferred_type,
            payload='' if payload_value is None or (isinstance(payload_value, float) and pd.isna(payload_value)) else str(payload_value),
            operation_station='' if station_op is None or (isinstance(station_op, float) and pd.isna(station_op)) else str(station_op).strip(),
            destination_station=str(station_dest).strip(),
            distance_km=_to_float(raw.get(col_map['distance_km'])) if col_map['distance_km'] else None,
            idle_days=_to_int(raw.get(col_map['idle_days'])) if col_map['idle_days'] else None,
            operation='' if operation is None or (isinstance(operation, float) and pd.isna(operation)) else str(operation).strip(),
            owner=owner,
            source_file=file_name,
            source_sheet=sheet_name,
            source_row_number=row_num,
        ))

    return rows, dropped
