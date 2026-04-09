from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('reports.urls')),
    path('api/', include('reports.api_urls')),
]
