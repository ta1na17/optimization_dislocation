"""
Эвристики для «кривых» Excel: заголовок не в первой строке, двухстрочная шапка, служебные строки.
"""

from __future__ import annotations

import re
from typing import Any

import pandas as pd


def _norm_cell(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ''
    return re.sub(r'\s+', ' ', str(v).strip().lower())


def _make_unique(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for n in names:
        base = (n or '').strip() or 'col'
        if base in seen:
            seen[base] += 1
            out.append(f'{base}__{seen[base]}')
        else:
            seen[base] = 0
            out.append(base)
    return out


def _row_header_score(values: list[Any]) -> int:
    text = ' '.join(_norm_cell(x) for x in values)
    score = 0
    if ('номер' in text and 'вагон' in text) or ('№' in text and 'вагон' in text):
        score += 4
    if 'вагон №' in text or '№ вагона' in text:
        score += 4
    if 'вагон' in text and ('/' in text or 'контейнер' in text):
        score += 3
    if 'станц' in text and ('опер' in text or 'последн' in text or 'текущ' in text or 'дислок' in text):
        score += 2
    if 'назнач' in text or 'назн' in text:
        score += 2
    if 'ост' in text and 'км' in text:
        score += 1
    if 'простой' in text or 'дней' in text and 'движ' in text:
        score += 1
    return score


def _first_row_looks_like_data(values: list[Any]) -> bool:
    if not values:
        return False
    v0 = values[0]
    if v0 is None or (isinstance(v0, float) and pd.isna(v0)):
        return False
    s = str(v0).strip()
    if re.fullmatch(r'\d{7,8}', s):
        return True
    return False


def _promote_row_to_header(df: pd.DataFrame, row_idx: int) -> pd.DataFrame:
    row = df.iloc[row_idx].tolist()
    names = [str(x).strip() if pd.notna(x) and str(x).strip() else f'__empty_{i}' for i, x in enumerate(row)]
    names = _make_unique(names)
    out = df.iloc[row_idx + 1 :].copy()
    out.columns = names
    out = out.dropna(how='all')
    out = out.reset_index(drop=True)
    return out


def _combine_two_header_rows(r_top: list[Any], r_bot: list[Any]) -> list[str]:
    n = max(len(r_top), len(r_bot))
    names: list[str] = []
    for i in range(n):
        t = r_top[i] if i < len(r_top) else None
        b = r_bot[i] if i < len(r_bot) else None
        bt = _norm_cell(b)
        tt = _norm_cell(t)
        chosen = None
        if bt and any(
            k in bt
            for k in (
                'станц',
                'дорог',
                'дата',
                'операц',
                'простой',
                'отправ',
                'назнач',
                'ост',
                'индекс',
                'поезд',
            )
        ):
            chosen = str(b).strip()
        elif bt and len(bt) > 2 and not bt.startswith('unnamed'):
            chosen = str(b).strip()
        elif tt and len(tt) > 2:
            chosen = str(t).strip()
        else:
            chosen = f'__empty_{i}'
        names.append(chosen)
    return _make_unique(names)


def _try_two_row_block_header(df: pd.DataFrame) -> pd.DataFrame | None:
    """Шаблон: строка с «Вагон», следующая — подзаголовки (Дислокация XLSX и аналоги)."""
    if len(df) < 4:
        return None
    r1 = df.iloc[1].tolist()
    r2 = df.iloc[2].tolist()
    t1 = ' '.join(_norm_cell(x) for x in r1)
    t2 = ' '.join(_norm_cell(x) for x in r2)
    if 'вагон' not in t1:
        return None
    if 'признак' in _norm_cell(df.iloc[0, 0]) or 'адресат' in _norm_cell(df.iloc[0, 0]):
        pass
    else:
        if 'станц' not in t2 and 'назнач' not in t2:
            return None
    names = _combine_two_header_rows(r1, r2)
    header_row_idx = 2
    data_start = header_row_idx + 1
    while data_start < len(df):
        rowv = df.iloc[data_start].tolist()
        if _first_row_looks_like_data(rowv):
            break
        data_start += 1
    if data_start >= len(df):
        return None
    out = df.iloc[data_start:].copy()
    out.columns = names[: out.shape[1]]
    if out.shape[1] < len(names):
        for j in range(out.shape[1], len(names)):
            out[names[j]] = None
    out = out.dropna(how='all')
    out = out.reset_index(drop=True)
    return out


def _try_approach_report_header(df: pd.DataFrame) -> pd.DataFrame | None:
    """Отчёт «Подход вагонов»: заголовок таблицы на ~4–5 строке, много пустых колонок слева."""
    for i in range(min(30, len(df))):
        row = df.iloc[i].tolist()
        cells = [str(x).strip() for x in row if pd.notna(x) and str(x).strip()]
        if any(c == 'Вагон №' for c in cells) or any('вагон №' in c.lower() for c in cells):
            names = [str(x).strip() if pd.notna(x) and str(x).strip() else f'__e{j}' for j, x in enumerate(row)]
            names = _make_unique(names)
            out = df.iloc[i + 1 :].copy()
            out.columns = names[: out.shape[1]]
            out = out.dropna(how='all')
            out = out.reset_index(drop=True)
            return out
    return None


def prepare_sheet_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    if df.shape[1] == 0:
        return df

    cols = [str(c) for c in df.columns]
    unnamed_ratio = sum(1 for c in cols if 'Unnamed' in str(c)) / max(len(cols), 1)

    joined_cols = ' '.join(c.lower() for c in cols)
    if (
        'номер вагона' in joined_cols
        or 'вагон №' in joined_cols
        or 'номер вагона / контейнера' in joined_cols
        or '№ вагона' in joined_cols
    ) and unnamed_ratio < 0.3:
        return df.dropna(how='all')

    raw = df.copy()
    if not raw.columns.equals(df.columns):
        raw = df

    if len(raw) >= 3:
        fixed = _try_two_row_block_header(raw)
        if fixed is not None and not fixed.empty:
            return fixed

    fixed2 = _try_approach_report_header(raw)
    if fixed2 is not None and not fixed2.empty:
        return fixed2

    best_idx = None
    best_score = 0
    scan = min(25, len(raw))
    for i in range(scan):
        row = raw.iloc[i].tolist()
        sc = _row_header_score(row)
        if sc > best_score:
            best_score = sc
            best_idx = i

    if best_idx is not None and best_score >= 4:
        promoted = _promote_row_to_header(raw, best_idx)
        if not promoted.empty:
            return promoted

    if unnamed_ratio > 0.45 and len(raw) > 1:
        row0 = raw.iloc[0].tolist()
        if _row_header_score(row0) >= 4:
            return _promote_row_to_header(raw, 0)

    return df.dropna(how='all')
