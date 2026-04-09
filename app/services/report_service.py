import tempfile
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.models.schemas import BuildResult, DroppedRow
from app.normalizers.row_normalizer import normalize_sheet
from app.parsers.excel_parser import parse_upload_file
from app.rules.distribution import distribute
from app.writers.excel_writer import write_result

RESULTS_DIR = Path('tmp_results')
RESULTS_DIR.mkdir(exist_ok=True)


class ReportService:
    @staticmethod
    def build_report(files: list[UploadFile]) -> BuildResult:
        all_rows = []
        dropped: list[DroppedRow] = []

        for f in files:
            try:
                sheets = parse_upload_file(f)
            except Exception:
                dropped.append(DroppedRow(file_name=f.filename, row_preview='-', reason='не удалось прочитать файл'))
                continue

            for sheet_name, df in sheets.items():
                normalized, local_dropped = normalize_sheet(df, f.filename, sheet_name)
                all_rows.extend(normalized)
                dropped.extend(local_dropped)

        grouped = distribute(all_rows)

        result_id = str(uuid.uuid4())
        output_file = RESULTS_DIR / f'{result_id}.xlsx'
        duplicates_count = write_result(grouped, output_file)

        return BuildResult(
            duplicates_count=duplicates_count,
            dropped_rows_count=len(dropped),
            dropped_rows=dropped,
            result_id=result_id,
        )
