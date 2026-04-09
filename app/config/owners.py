import re
from dataclasses import dataclass


@dataclass(frozen=True)
class OwnerRule:
    canonical_name: str
    synonyms: list[str]
    file_name_synonyms: list[str]


OWNER_RULES: list[OwnerRule] = [
    OwnerRule("Транзит", ["Транзит", "Transit"], ["транзит", "transit"]),
    OwnerRule("ПМГрупп", ["ПМГрупп", "ПМ групп", "PMGroup"], ["pmgroup", "пмгрупп", "пм групп"]),
    OwnerRule("ВагонСервис", ["ВагонСервис", "Вагон Сервис"], ["вагонсервис", "вагон сервис"]),
    OwnerRule("Атлант", ["Атлант", "ALN"], ["атлант", "aln"]),
    OwnerRule("РефСервис", ["РефСервис", "RDB"], ["рефсервис", "rdb"]),
    OwnerRule("Модум Транс", ["Модум Транс", "Модум", "UVZ"], ["модум", "uvz"]),
    OwnerRule("РЛС", ["РЛС", "RLS"], ["рлс", "rls"]),
    OwnerRule("Еврологистик", ["Еврологистик", "Евро логистик"], ["еврологистик", "евро логистик"]),
    OwnerRule("ПТА", ["ПТА", "PTA"], ["пта", "pta"]),
    OwnerRule("Веста Карго", ["Веста Карго", "Vesta Cargo"], ["веста карго", "vesta cargo"]),
    OwnerRule("КалугаВагонСервис", ["КалугаВагонСервис", "КВС", "KVS"], ["калугавагонсервис", "квс", "kvs"]),
    OwnerRule("УралТранс", ["УралТранс", "Уралтранс", "Урал Транс"], ["уралтранс", "урал транс", "uraltrans"]),
    OwnerRule("ТЭК Урал", ["ТЭК Урал", "Тек Урал", "TEK Ural"], ["тэк урал", "tek ural"]),
    OwnerRule("Транспортные Технологии", ["Транспортные Технологии", "ТТ", "TTS"], ["транспортные технологии", "тт", "tts"]),
    OwnerRule("Транком-Сервис", ["Транком-Сервис", "Транком", "TCS"], ["транком", "tcs"]),
    OwnerRule("Евросиб", ["Евросиб", "EuroSib"], ["евросиб", "eurosib"]),
    OwnerRule("Аквила Транс", ["Аквила Транс", "Аквила", "Aquila"], ["аквила", "aquila"]),
]

CANONICAL_OWNER_NAMES = [r.canonical_name for r in OWNER_RULES]

OWNER_TO_TYPE = {
    "Атлант": "КВ",
    "ПМГрупп": "КВ",
    "Транзит": "КВ",
    "ПТА": "КВ",
    "Евросиб": "КВ",
    "Еврологистик": "КВ",
    "Транспортные Технологии": "ПВ",
    "УралТранс": "ПВ",
    "Модум Транс": "ПВ",
    "ТЭК Урал": "ПВ",
}


def normalize_text(value: str) -> str:
    normalized = re.sub(r"\s+", " ", value.strip().lower())
    return normalized


def is_safe_short_token_match(token: str, text: str) -> bool:
    token = token.lower()
    if len(token) <= 3:
        return re.search(rf"(?:^|[^a-zа-я0-9]){re.escape(token)}(?:$|[^a-zа-я0-9])", text.lower()) is not None
    return token in text.lower()
