import re
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class BuiltDashboardStaticTests(SimpleTestCase):
    def test_collected_frontend_assets_are_served_by_whitenoise(self):
        index_file = Path(settings.DASHBOARD_BUILD_DIR) / "index.html"
        if not index_file.is_file():
            self.skipTest("Run npm run build:web before the static integration test.")

        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        page_content = b"".join(page.streaming_content)
        match = re.search(
            rb'(?:src|href)="(/static/dashboard/assets/[^"]+\.(?:js|css))"',
            page_content,
        )
        self.assertIsNotNone(match)
        asset_response = self.client.get(match.group(1).decode("ascii"))
        self.assertEqual(asset_response.status_code, 200)
