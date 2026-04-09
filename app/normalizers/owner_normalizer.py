from app.config.owners import OWNER_RULES, is_safe_short_token_match, normalize_text


def detect_owner_from_text(*values: str | None) -> str | None:
    text = ' '.join(str(v) for v in values if v is not None)
    normalized = normalize_text(text)
    for rule in OWNER_RULES:
        for synonym in rule.synonyms:
            if is_safe_short_token_match(normalize_text(synonym), normalized):
                return rule.canonical_name
    return None


def detect_owner_from_filename(file_name: str) -> str | None:
    normalized = normalize_text(file_name)
    for rule in OWNER_RULES:
        for synonym in rule.file_name_synonyms + rule.synonyms:
            if is_safe_short_token_match(normalize_text(synonym), normalized):
                return rule.canonical_name
    return None
