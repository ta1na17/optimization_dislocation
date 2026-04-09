import re
from dataclasses import dataclass


@dataclass(frozen=True)
class OwnerRule:
    canonical_name: str
    synonyms: list[str]
    file_name_synonyms: list[str]


OWNER_RULES = [
    OwnerRule('Транзит', ['Транзит', 'Transit'], ['транзит', 'transit']),
    OwnerRule('ПМГрупп', ['ПМГрупп', 'ПМ групп', 'PMGroup'], ['пмгрупп', 'пм групп', 'pmgroup']),
    OwnerRule('ВагонСервис', ['ВагонСервис', 'Вагон Сервис'], ['вагонсервис', 'вагон сервис']),
    OwnerRule('Атлант', ['Атлант', 'ALN'], ['атлант', 'aln']),
    OwnerRule('РефСервис', ['РефСервис', 'RDB'], ['рефсервис', 'rdb']),
    OwnerRule('Модум Транс', ['Модум Транс', 'Модум', 'UVZ'], ['модум', 'uvz']),
    OwnerRule('РЛС', ['РЛС', 'RLS'], ['рлс', 'rls']),
    OwnerRule('Еврологистик', ['Еврологистик', 'Евро логистик'], ['еврологистик', 'евро логистик']),
    OwnerRule('ПТА', ['ПТА', 'PTA'], ['пта', 'pta']),
    OwnerRule('Веста Карго', ['Веста Карго', 'Vesta Cargo'], ['веста карго', 'vesta cargo']),
    OwnerRule('КалугаВагонСервис', ['КалугаВагонСервис', 'КВС', 'KVS'], ['калугавагонсервис', 'квс', 'kvs']),
    OwnerRule('УралТранс', ['УралТранс', 'Уралтранс', 'Урал Транс'], ['уралтранс', 'урал транс', 'uraltrans']),
    OwnerRule('ТЭК Урал', ['ТЭК Урал', 'Тек Урал', 'TEK Ural'], ['тэк урал', 'tek ural']),
    OwnerRule('Транспортные Технологии', ['Транспортные Технологии', 'ТТ', 'TTS'], ['транспортные технологии', 'тт', 'tts']),
    OwnerRule('Транком-Сервис', ['Транком-Сервис', 'Транком', 'TCS'], ['транком', 'tcs']),
    OwnerRule('Евросиб', ['Евросиб', 'EuroSib'], ['евросиб', 'eurosib']),
    OwnerRule('Аквила Транс', ['Аквила Транс', 'Аквила', 'Aquila'], ['аквила', 'aquila']),
]

CANONICAL_OWNER_NAMES = [r.canonical_name for r in OWNER_RULES]

OWNER_TO_TYPE = {
    'Атлант': 'КВ', 'ПМГрупп': 'КВ', 'Транзит': 'КВ', 'ПТА': 'КВ', 'Евросиб': 'КВ', 'Еврологистик': 'КВ',
    'Транспортные Технологии': 'ПВ', 'УралТранс': 'ПВ', 'Модум Транс': 'ПВ', 'ТЭК Урал': 'ПВ',
}


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
    for rule in OWNER_RULES:
        for synonym in rule.synonyms:
            if is_safe_short_token_match(normalize_text(synonym), text):
                return rule.canonical_name
    return None


def detect_owner_from_filename(file_name: str) -> str | None:
    text = normalize_text(file_name)
    for rule in OWNER_RULES:
        for synonym in rule.file_name_synonyms + rule.synonyms:
            if is_safe_short_token_match(normalize_text(synonym), text):
                return rule.canonical_name
    return None


def normalize_canonical_owner(value: str | None) -> str | None:
    """Приводит строку к каноническому имени из библиотеки или None."""
    if not value or not str(value).strip():
        return None
    v = str(value).strip()
    for name in CANONICAL_OWNER_NAMES:
        if v == name:
            return name
    nv = normalize_text(v)
    for rule in OWNER_RULES:
        if normalize_text(rule.canonical_name) == nv:
            return rule.canonical_name
        for syn in rule.synonyms + rule.file_name_synonyms:
            if normalize_text(syn) == nv:
                return rule.canonical_name
    return None
