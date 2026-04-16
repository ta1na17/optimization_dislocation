import json
import re
from dataclasses import dataclass
from pathlib import Path

USER_RULES_PATH = Path(__file__).resolve().parent.parent / 'data' / 'owners_user.json'


@dataclass(frozen=True)
class OwnerRule:
    canonical_name: str
    synonyms: tuple[str, ...]
    file_name_synonyms: tuple[str, ...]


def _tup(seq) -> tuple[str, ...]:
    if not seq:
        return ()
    out: list[str] = []
    for x in seq:
        s = str(x).strip()
        if s:
            out.append(s)
    return tuple(out)


_DEFAULT_RULES: tuple[OwnerRule, ...] = (
    OwnerRule('Транзит', _tup(['Транзит', 'Transit']), _tup(['транзит', 'transit'])),
    OwnerRule('ПМГрупп', _tup(['ПМГрупп', 'ПМ групп', 'PMGroup']), _tup(['пмгрупп', 'пм групп', 'pmgroup'])),
    OwnerRule('ВагонСервис', _tup(['ВагонСервис', 'Вагон Сервис']), _tup(['вагонсервис', 'вагон сервис'])),
    OwnerRule('Атлант', _tup(['Атлант', 'ALN']), _tup(['атлант', 'aln'])),
    OwnerRule('РефСервис', _tup(['РефСервис', 'RDB']), _tup(['рефсервис', 'rdb'])),
    OwnerRule('Модум Транс', _tup(['Модум Транс', 'Модум', 'UVZ']), _tup(['модум', 'uvz'])),
    OwnerRule('РЛС', _tup(['РЛС', 'RLS']), _tup(['рлс', 'rls'])),
    OwnerRule('Еврологистик', _tup(['Еврологистик', 'Евро логистик']), _tup(['еврологистик', 'евро логистик'])),
    OwnerRule('ПТА', _tup(['ПТА', 'PTA']), _tup(['пта', 'pta'])),
    OwnerRule('Веста Карго', _tup(['Веста Карго', 'Vesta Cargo']), _tup(['веста карго', 'vesta cargo'])),
    OwnerRule('КалугаВагонСервис', _tup(['КалугаВагонСервис', 'КВС', 'KVS']), _tup(['калугавагонсервис', 'квс', 'kvs'])),
    OwnerRule('УралТранс', _tup(['УралТранс', 'Уралтранс', 'Урал Транс']), _tup(['уралтранс', 'урал транс', 'uraltrans'])),
    OwnerRule('ТЭК Урал', _tup(['ТЭК Урал', 'Тек Урал', 'TEK Ural']), _tup(['тэк урал', 'tek ural'])),
    OwnerRule(
        'Транспортные Технологии',
        _tup(['Транспортные Технологии', 'ТТ', 'TTS']),
        _tup(['транспортные технологии', 'тт', 'tts']),
    ),
    OwnerRule('Транком-Сервис', _tup(['Транком-Сервис', 'Транком', 'TCS']), _tup(['транком', 'tcs'])),
    OwnerRule('Евросиб', _tup(['Евросиб', 'EuroSib']), _tup(['евросиб', 'eurosib'])),
    OwnerRule('Аквила Транс', _tup(['Аквила Транс', 'Аквила', 'Aquila']), _tup(['аквила', 'aquila'])),
    OwnerRule(
        'Деловой портал',
        _tup(['Деловой портал', 'Деловой портал', 'Деловой портал']),
        _tup(['Деловой портал', 'Деловой портал']),
    ),
    OwnerRule(
        'TOO TCM Logisticts',
        _tup(['TOO TCM Logisticts', 'TOO TCM Logisticts', 'TOO TCM Logisticts']),
        _tup(['TOO TCM Logisticts', 'TOO TCM Logisticts']),
    ),
)

_runtime_rules: list[OwnerRule] = []

OWNER_TO_TYPE = {
    'Атлант': 'КВ',
    'ПМГрупп': 'КВ',
    'Транзит': 'КВ',
    'ПТА': 'КВ',
    'Евросиб': 'КВ',
    'Еврологистик': 'КВ',
    'Транспортные Технологии': 'ПВ',
    'УралТранс': 'ПВ',
    'Модум Транс': 'ПВ',
    'ТЭК Урал': 'ПВ',
}


def _rules_from_json_payload(data) -> list[OwnerRule] | None:
    if not isinstance(data, dict):
        return None
    raw = data.get('rules')
    if not isinstance(raw, list):
        return None
    out: list[OwnerRule] = []
    for item in raw:
        if not isinstance(item, dict):
            return None
        name = str(item.get('canonical_name', '')).strip()
        if not name:
            return None
        sy = item.get('synonyms')
        fsy = item.get('file_name_synonyms')
        if sy is None:
            sy = ()
        elif isinstance(sy, str):
            sy = [p.strip() for p in sy.split(',') if p.strip()]
        elif not isinstance(sy, (list, tuple)):
            return None
        if fsy is None:
            fsy = ()
        elif isinstance(fsy, str):
            fsy = [p.strip() for p in fsy.split(',') if p.strip()]
        elif not isinstance(fsy, (list, tuple)):
            return None
        out.append(OwnerRule(name, _tup(sy), _tup(fsy)))
    return out


def _load_rules_from_file() -> list[OwnerRule] | None:
    if not USER_RULES_PATH.is_file():
        return None
    try:
        text = USER_RULES_PATH.read_text(encoding='utf-8')
        data = json.loads(text)
    except (OSError, json.JSONDecodeError):
        return None
    rules = _rules_from_json_payload(data)
    if not rules:
        return None
    return rules


def reload_owner_rules_from_disk() -> None:
    """Перечитать правила с диска (или сброс к умолчанию, если файла нет)."""
    global _runtime_rules
    loaded = _load_rules_from_file()
    _runtime_rules = loaded if loaded else list(_DEFAULT_RULES)


def _bootstrap_runtime_rules() -> None:
    global _runtime_rules
    loaded = _load_rules_from_file()
    _runtime_rules = loaded if loaded else list(_DEFAULT_RULES)


_bootstrap_runtime_rules()


def canonical_owner_names() -> list[str]:
    return [r.canonical_name for r in _runtime_rules]


def serialize_owner_rules() -> list[dict]:
    return [
        {
            'canonical_name': r.canonical_name,
            'synonyms': list(r.synonyms),
            'file_name_synonyms': list(r.file_name_synonyms),
        }
        for r in _runtime_rules
    ]


def _split_csv(s: str) -> tuple[str, ...]:
    if not s or not str(s).strip():
        return ()
    return _tup(p.strip() for p in str(s).split(',') if p.strip())


def parse_client_rules(payload: list[dict]) -> tuple[list[OwnerRule] | None, str | None]:
    if not isinstance(payload, list):
        return None, 'Ожидался массив rules'
    if len(payload) < 1:
        return None, 'Нужен хотя бы один собственник'
    seen: set[str] = set()
    out: list[OwnerRule] = []
    for i, item in enumerate(payload):
        if not isinstance(item, dict):
            return None, f'Элемент {i + 1}: ожидался объект'
        name = str(item.get('canonical_name', '')).strip()
        if not name:
            return None, f'Элемент {i + 1}: пустое каноническое имя'
        key = normalize_text(name)
        if key in seen:
            return None, f'Дублируется каноническое имя (после нормализации): {name!r}'
        seen.add(key)
        sy_raw = item.get('synonyms', '')
        fsy_raw = item.get('file_name_synonyms', '')
        if isinstance(sy_raw, list):
            sy = _tup(sy_raw)
        else:
            sy = _split_csv(str(sy_raw))
        if isinstance(fsy_raw, list):
            fsy = _tup(fsy_raw)
        else:
            fsy = _split_csv(str(fsy_raw))
        out.append(OwnerRule(name, sy, fsy))
    return out, None


def _rules_diff(before: list[OwnerRule], after: list[OwnerRule]) -> dict:
    b_map = {r.canonical_name: r for r in before}
    a_map = {r.canonical_name: r for r in after}
    removed = sorted(set(b_map) - set(a_map))
    added = sorted(set(a_map) - set(b_map))
    syn_updated: list[str] = []
    for name in sorted(set(b_map) & set(a_map)):
        br, ar = b_map[name], a_map[name]
        if br.synonyms != ar.synonyms or br.file_name_synonyms != ar.file_name_synonyms:
            syn_updated.append(name)
    return {'removed': removed, 'added': added, 'synonyms_updated': syn_updated}


def _format_summary(diff: dict) -> str:
    parts: list[str] = []
    if diff['removed']:
        parts.append('Удалены: ' + ', '.join(diff['removed']))
    if diff['added']:
        parts.append('Добавлены: ' + ', '.join(diff['added']))
    if diff['synonyms_updated']:
        parts.append('Обновлены синонимы: ' + ', '.join(diff['synonyms_updated']))
    if not parts:
        return 'Изменений по сравнению с предыдущим сохранённым списком не обнаружено.'
    return 'Изменения: ' + '; '.join(parts) + '.'


def apply_owner_rules_payload(payload: list[dict]) -> tuple[bool, str | None, dict]:
    """
    Валидирует payload, сохраняет в JSON, обновляет runtime.
    Возвращает (ok, error_message, extra) где extra при успехе содержит summary и canonical_names.
    """
    global _runtime_rules
    parsed, err = parse_client_rules(payload)
    if err or not parsed:
        return False, err or 'Ошибка разбора', {}
    before = list(_runtime_rules)
    diff = _rules_diff(before, parsed)
    summary_text = _format_summary(diff)
    try:
        USER_RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = USER_RULES_PATH.with_suffix('.json.tmp')
        tmp.write_text(
            json.dumps({'rules': serialize_owner_rules_from_list(parsed)}, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        tmp.replace(USER_RULES_PATH)
    except OSError as e:
        return False, f'Не удалось сохранить файл: {e}', {}
    _runtime_rules = parsed
    return True, None, {
        'summary': summary_text,
        'canonical_names': canonical_owner_names(),
        'diff': diff,
    }


def serialize_owner_rules_from_list(rules: list[OwnerRule]) -> list[dict]:
    return [
        {'canonical_name': r.canonical_name, 'synonyms': list(r.synonyms), 'file_name_synonyms': list(r.file_name_synonyms)}
        for r in rules
    ]


def normalize_text(value: str) -> str:
    return re.sub(r'\s+', ' ', (value or '').strip().lower())


def is_safe_short_token_match(token: str, text: str) -> bool:
    token = token.lower()
    text = text.lower()
    if len(token) <= 3:
        return re.search(rf'(?:^|[^a-zа-я0-9]){re.escape(token)}(?:$|[^a-zа-я0-9])', text) is not None
    return token in text


def detect_owner_from_text(*values: str | None) -> str | None:
    text = normalize_text(' '.join(str(v) for v in values if v is not None))
    for rule in _runtime_rules:
        for synonym in rule.synonyms:
            if is_safe_short_token_match(normalize_text(synonym), text):
                return rule.canonical_name
    return None


def detect_owner_from_filename(file_name: str) -> str | None:
    text = normalize_text(file_name)
    for rule in _runtime_rules:
        for synonym in rule.file_name_synonyms + rule.synonyms:
            if is_safe_short_token_match(normalize_text(synonym), text):
                return rule.canonical_name
    return None


def normalize_canonical_owner(value: str | None) -> str | None:
    """Приводит строку к каноническому имени из библиотеки или None."""
    if not value or not str(value).strip():
        return None
    v = str(value).strip()
    names = canonical_owner_names()
    for name in names:
        if v == name:
            return name
    nv = normalize_text(v)
    for rule in _runtime_rules:
        if normalize_text(rule.canonical_name) == nv:
            return rule.canonical_name
        for syn in rule.synonyms + rule.file_name_synonyms:
            if normalize_text(syn) == nv:
                return rule.canonical_name
    return None
