from collections import defaultdict

from app.config.stations import BASE_STATIONS
from app.models.schemas import NormalizedRow


SHEET_ORDER = ['ПСК', 'АлОр', 'Индер']


def sheet_by_destination(destination: str | None) -> str:
    destination = (destination or '').strip().lower()
    if destination == BASE_STATIONS['ПСК'].lower():
        return 'ПСК'
    if destination == BASE_STATIONS['АлОр'].lower():
        return 'АлОр'
    if destination == BASE_STATIONS['Индер'].lower():
        return 'Индер'
    return 'ПСК'


def block_for_row(row: NormalizedRow, current_sheet: str) -> int:
    op = (row.operation_station or '').strip().lower()
    dest = (row.destination_station or '').strip().lower()
    base = BASE_STATIONS[current_sheet].lower()

    if op and dest and op == dest:
        return 1
    if dest == base and op != dest:
        return 2
    if dest not in {BASE_STATIONS['ПСК'].lower(), BASE_STATIONS['АлОр'].lower(), BASE_STATIONS['Индер'].lower()}:
        return 3
    return 3


def distribute(rows: list[NormalizedRow]) -> dict[str, dict[int, list[NormalizedRow]]]:
    grouped = {sheet: defaultdict(list) for sheet in SHEET_ORDER}
    for row in rows:
        sheet = sheet_by_destination(row.destination_station)
        block = block_for_row(row, sheet)
        grouped[sheet][block].append(row)

    for sheet in SHEET_ORDER:
        grouped[sheet][1].sort(key=lambda r: (r.idle_days is None, -(r.idle_days or 0)))
        grouped[sheet][2].sort(key=lambda r: (r.distance_km is None, r.distance_km or 0))
        grouped[sheet][3].sort(key=lambda r: (r.idle_days is None, -(r.idle_days or 0)))

    return grouped
