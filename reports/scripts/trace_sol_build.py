#!/usr/bin/env python3
"""
Прогон сборки по файлам из /home/stas/Соль и текстовый лог: лист итога + блок + правило ТЗ.
Запуск из корня проекта: python reports/scripts/trace_sol_build.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Django
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.core.files.uploadedfile import SimpleUploadedFile

from reports.services.report_builder import (
    BASE_STATIONS,
    DROP_REASON_NON_BASE_DESTINATION,
    DROP_REASON_SECTION_NO_ANCHOR,
    SHEET_ORDER,
    _block_for_row,
    _is_subtable_header_row,
    _normalize_rows,
    _normalize_station_label,
    _parse_file,
    _sheet_for_destination,
    preview_owner_for_file,
)


SOL_ROOT = Path("/home/stas/Соль")


def collect_excel_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix.lower() in (".xls", ".xlsx"):
            out.append(p)
    return out


def explain_sheet(dest: str | None) -> tuple[str | None, str]:
    sheet = _sheet_for_destination(dest)
    if sheet:
        disp = (dest or "").strip() or "(пусто)"
        station = BASE_STATIONS[sheet]
        return sheet, (
            f"станция назначения «{disp}» = базовая станция листа «{sheet}» "
            f"({station} по ТЗ п.9)"
        )
    return None, DROP_REASON_NON_BASE_DESTINATION


def explain_block(row, sheet: str) -> str:
    op = _normalize_station_label(row.operation_station)
    dest = _normalize_station_label(row.destination_station)
    base = _normalize_station_label(BASE_STATIONS[sheet])
    bases_l = {_normalize_station_label(b) for b in BASE_STATIONS.values()}

    if op and dest and op == dest:
        return (
            "блок 1 — вагон уже на станции (ТЗ п.10.1): "
            "станция операции совпадает со станцией назначения"
        )
    if dest == base and op != dest:
        return (
            f"блок 2 — вагон на подходе (ТЗ п.10.2): станция назначения = база листа «{sheet}» "
            f"({BASE_STATIONS[sheet]}), станция операции отличается"
        )
    if dest not in bases_l:
        return (
            "блок 3 — назначение не на базовую станцию (ТЗ п.10.3): "
            "станция назначения не Калкаман / Кызылорда / Макат"
        )
    return (
        "блок 3 (остальные случаи на листе): правило _block_for_row → 3 "
        "(например назначение — другая база, не база текущего листа)"
    )


def main() -> int:
    if not SOL_ROOT.is_dir():
        print(f"Нет каталога: {SOL_ROOT}", file=sys.stderr)
        return 1

    paths = collect_excel_files(SOL_ROOT)
    if not paths:
        print(f"В {SOL_ROOT} не найдено .xls/.xlsx", file=sys.stderr)
        return 1

    files: list[SimpleUploadedFile] = []
    for p in paths:
        rel = p.relative_to(SOL_ROOT)
        data = p.read_bytes()
        files.append(
            SimpleUploadedFile(
                str(rel).replace("\\", "/"),
                data,
                content_type="application/octet-stream",
            )
        )

    print("=== ПРОГОН: файлов Excel:", len(files), "===")
    for i, f in enumerate(files, 1):
        print(f"  {i}. {f.name}")

    all_rows: list = []
    dropped_normalize: list[dict] = []
    for idx, f in enumerate(files):
        manual = None
        try:
            sheets = _parse_file(f)
        except Exception as exc:
            print(f"\n[ОШИБКА ЧТЕНИЯ] {f.name}: {exc}")
            return 1

        preview_info = preview_owner_for_file(f.name, sheets)
        auto_owner = None
        if preview_info.get("source") in ("content", "filename") and preview_info.get("detected_owner"):
            auto_owner = preview_info["detected_owner"]
        file_owner_fallback = manual or auto_owner

        for sheet_name, df in sheets.items():
            rows, drop_rows = _normalize_rows(
                f.name, sheet_name, df, file_owner_fallback=file_owner_fallback
            )
            all_rows.extend(rows)
            dropped_normalize.extend(drop_rows)

    dropped_route: list[dict] = []
    from collections import defaultdict

    grouped = {s: defaultdict(int) for s in SHEET_ORDER}
    eligible = []
    section_anchor: dict[tuple[str, str], tuple[str, str]] = {}
    pre_makat_tail: dict[tuple[str, str], bool] = {}
    for row in all_rows:
        key = (row.source_file, row.source_sheet)
        if _is_subtable_header_row(row):
            an = section_anchor.get(key)
            if an and an[1] == "АлОр":
                pre_makat_tail[key] = True
            continue

        dest_norm = _normalize_station_label(row.destination_station)
        sh = _sheet_for_destination(row.destination_station)
        if sh is not None:
            pre_makat_tail[key] = False
            section_anchor[key] = (dest_norm, sh)
            bl = _block_for_row(row, sh)
            grouped[sh][bl] += 1
            eligible.append((row, sh, bl))
            continue

        if pre_makat_tail.get(key):
            grouped["Индер"][3] += 1
            eligible.append((row, "Индер", 3))
            continue

        anchor = section_anchor.get(key)
        if anchor is not None:
            anchor_dest, anchor_sheet = anchor
            if dest_norm != anchor_dest:
                grouped[anchor_sheet][3] += 1
                eligible.append((row, anchor_sheet, 3))
                continue
        dropped_route.append(
            {
                "file_name": row.source_file,
                "sheet_name": row.source_sheet,
                "row_number": row.source_row_number,
                "row_preview": (
                    f"Вагон={row.wagon}, ст.опер.={row.operation_station!r}, ст.назн.={row.destination_station!r}"
                ),
                "reason": DROP_REASON_SECTION_NO_ANCHOR if not dest_norm else DROP_REASON_NON_BASE_DESTINATION,
            }
        )

    print("\n=== СТАТИСТИКА ===")
    print("Нормализованных строк (до отбора по базам):", len(all_rows))
    print("В итоговый файл (базовая станция назначения):", len(eligible))
    print("Отброшено при нормализации:", len(dropped_normalize))
    print("Отброшено: назначение не базовая станция:", len(dropped_route))

    print("\n=== СВОДКА по листам и блокам (только строки в итоге) ===")
    for sh in SHEET_ORDER:
        for b in (1, 2, 3):
            n = grouped[sh][b]
            if n:
                print(f"  {sh} / блок {b}: {n} строк")

    if dropped_route:
        print("\n=== ОТБРОШЕНЫ: назначение не Калкаман/Кызылорда/Макат (первые 40) ===")
        for d in dropped_route[:40]:
            print(
                f"  {d['file_name']} | {d['sheet_name']} | строка {d['row_number']} | {d['row_preview']}\n"
                f"    причина: {d['reason']}"
            )
        if len(dropped_route) > 40:
            print(f"  ... ещё {len(dropped_route) - 40} строк")

    print("\n=== ЛОГ ПО СТРОКАМ В ИТОГЕ (лист + блок) ===")
    for n, (row, sheet, block) in enumerate(eligible, 1):
        if _sheet_for_destination(row.destination_station):
            sh_why = explain_sheet(row.destination_station)[1]
        else:
            sh_why = (
                f"лист «{sheet}», блок 3: назначение не совпадает с базой текущей секции "
                "(файл-исключение: в итог только такие строки; строки с назначением = база секции не включаются)"
            )
        bl_why = explain_block(row, sheet)
        w = row.wagon
        op = row.operation_station or "—"
        dest = row.destination_station or "—"
        own = row.owner or "—"
        print(
            f"\n--- #{n} | вагон {w} | файл: {row.source_file} | лист источника: {row.source_sheet} | "
            f"строка Excel≈{row.source_row_number} ---"
        )
        print(f"    собственник в строке: {own}")
        print(f"    станция операции: {op}  |  станция назначения: {dest}")
        print(f"    → итоговый лист «{sheet}»: {sh_why}")
        print(f"    → блок {block}: {bl_why}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
