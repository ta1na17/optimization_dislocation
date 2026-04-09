from io import BytesIO

import pandas as pd
from fastapi import UploadFile


def parse_upload_file(file: UploadFile) -> dict[str, pd.DataFrame]:
    content = file.file.read()
    file.file.seek(0)
    suffix = file.filename.lower()
    if suffix.endswith('.xlsx'):
        return pd.read_excel(BytesIO(content), sheet_name=None, dtype=object, engine='openpyxl')
    if suffix.endswith('.xls'):
        return pd.read_excel(BytesIO(content), sheet_name=None, dtype=object, engine='xlrd')
    raise ValueError('Формат файла не поддерживается')
