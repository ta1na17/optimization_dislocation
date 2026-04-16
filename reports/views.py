import json

from django.shortcuts import render

from reports.services.owners import canonical_owner_names


def index(request):
    names = canonical_owner_names()
    return render(
        request,
        'index.html',
        {
            'owners': names,
            'owners_json': json.dumps(names, ensure_ascii=False),
        },
    )
