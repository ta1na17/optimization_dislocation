from django.urls import path
from .api_views import BuildReportApi, HealthApi, PreviewOwnersApi

urlpatterns = [
    path('health/', HealthApi.as_view(), name='api-health'),
    path('preview-owners/', PreviewOwnersApi.as_view(), name='api-preview-owners'),
    path('build-report/', BuildReportApi.as_view(), name='api-build-report'),
]
