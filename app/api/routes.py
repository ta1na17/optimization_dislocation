from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates

from app.config.owners import CANONICAL_OWNER_NAMES
from app.services.report_service import RESULTS_DIR, ReportService

router = APIRouter()
templates = Jinja2Templates(directory='app/templates')


@router.get('/health')
def health() -> dict:
    return {'status': 'ok'}


@router.get('/')
def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name='index.html',
        context={'owners': CANONICAL_OWNER_NAMES},
    )


@router.post('/build-report')
def build_report(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail='Не загружены файлы')

    for f in files:
        if not (f.filename.lower().endswith('.xls') or f.filename.lower().endswith('.xlsx')):
            raise HTTPException(status_code=400, detail='Формат файла не поддерживается')

    result = ReportService.build_report(files)
    return result.model_dump()


@router.get('/download/{result_id}')
def download(result_id: str):
    path = RESULTS_DIR / f'{result_id}.xlsx'
    if not Path(path).exists():
        raise HTTPException(status_code=404, detail='Файл не найден')
    return FileResponse(path, filename='Итог.xlsx', media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
