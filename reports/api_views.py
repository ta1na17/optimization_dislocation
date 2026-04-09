import json
import logging

from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.views import APIView

from reports.services.report_builder import (
    build_report,
    preview_owners_for_uploads,
    validate_owner_choices_for_build,
)

logger = logging.getLogger('reports.api')


class HealthApi(APIView):
    def get(self, request):
        return Response({'status': 'ok'})


class PreviewOwnersApi(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        files = request.FILES.getlist('files')
        logger.info('Preview owners called with %s files', len(files))
        if not files:
            return Response({'detail': 'Не загружены файлы'}, status=status.HTTP_400_BAD_REQUEST)
        items = preview_owners_for_uploads(files)
        return Response({'files': items}, status=status.HTTP_200_OK)


class BuildReportApi(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        files = request.FILES.getlist('files')
        logger.info('Build report called with %s files', len(files))
        if not files:
            logger.warning('No files uploaded')
            return Response({'detail': 'Не загружены файлы'}, status=status.HTTP_400_BAD_REQUEST)

        raw = request.POST.get('owner_overrides', '[]')
        try:
            owner_overrides = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning('Invalid owner_overrides JSON: %s', raw[:200])
            return Response({'detail': 'Некорректные данные подстановки собственников'}, status=status.HTTP_400_BAD_REQUEST)

        if not isinstance(owner_overrides, list):
            return Response({'detail': 'owner_overrides должен быть массивом'}, status=status.HTTP_400_BAD_REQUEST)

        choice_error = validate_owner_choices_for_build(files, owner_overrides)
        if choice_error:
            return Response({'detail': choice_error}, status=status.HTTP_400_BAD_REQUEST)

        result, error = build_report(files, owner_overrides=owner_overrides)
        if error:
            logger.exception('Build report failed: %s', error)
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_200_OK)
