import json

from django.shortcuts import render

from reports.services.owners import CANONICAL_OWNER_NAMES


def index(request):
    return render(
        request,
        'index.html',
        {
            'owners': CANONICAL_OWNER_NAMES,
            'owners_json': json.dumps(CANONICAL_OWNER_NAMES, ensure_ascii=False),
        },
    )
