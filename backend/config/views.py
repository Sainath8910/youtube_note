from django.conf import settings
from django.http import FileResponse, HttpResponseServerError


def dashboard(request):
    index_file = settings.DASHBOARD_BUILD_DIR / "index.html"
    if not index_file.is_file():
        return HttpResponseServerError(
            "The dashboard build is missing. Run the extension web build first."
        )
    return FileResponse(
        index_file.open("rb"),
        content_type="text/html; charset=utf-8",
    )
