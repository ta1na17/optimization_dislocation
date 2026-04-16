import json
import logging

from rest_framework import status
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.views import APIView

from reports.services.owners import apply_owner_rules_payload, serialize_owner_rules
from reports.services.report_builder import (
    build_report,
    preview_owners_for_uploads,
    validate_owner_choices_for_build,
)

logger = logging.getLogger('reports.api')


class HealthApi(APIView):
    def get(self, request):
        return Response({'status': 'ok'})


class OwnersConfigApi(APIView):
    parser_classes = [JSONParser]

    def get(self, request):
        return Response({'rules': serialize_owner_rules()})

    def post(self, request):
        raw = request.data.get('rules') if isinstance(request.data, dict) else None
        if not isinstance(raw, list):
            return Response({'detail': 'Ожидался объект с полем rules (массив)'}, status=status.HTTP_400_BAD_REQUEST)
        ok, err, extra = apply_owner_rules_payload(raw)
        if not ok:
            return Response({'detail': err or 'Ошибка сохранения'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                'summary': extra.get('summary', ''),
                'canonical_names': extra.get('canonical_names', []),
                'diff': extra.get('diff', {}),
            },
            status=status.HTTP_200_OK,
        )


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
