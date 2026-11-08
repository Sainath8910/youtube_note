import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings
from django.contrib.staticfiles import finders


class DashboardRoutesTests(SimpleTestCase):
    def setUp(self):
        self.build_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.build_dir.cleanup)
        self.index_file = Path(self.build_dir.name) / "index.html"
        self.index_file.write_text(
            "<!doctype html><div id='root'>dashboard bundle</div>",
            encoding="utf-8",
        )
        self.static_root = Path(self.build_dir.name) / "static-root"
        self.static_root.mkdir()
        self.dashboard_build_override = override_settings(
            DASHBOARD_BUILD_DIR=Path(self.build_dir.name),
            STATIC_ROOT=self.static_root,
        )
        self.dashboard_build_override.enable()
        self.addCleanup(self.dashboard_build_override.disable)

    def test_root_serves_the_dashboard_build(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
        self.assertContains(response, "dashboard bundle")

    def test_non_api_path_uses_dashboard_fallback(self):
        response = self.client.get("/notes/42/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "dashboard bundle")

    def test_admin_route_is_not_captured_by_dashboard(self):
        response = self.client.get("/admin/")

        self.assertIn(response.status_code, {301, 302})
        self.assertIn("/admin/login/", response["Location"])

    def test_unknown_api_route_remains_a_404(self):
        response = self.client.get("/api/not-a-route/")

        self.assertEqual(response.status_code, 404)
        self.assertNotContains(
            response,
            "dashboard bundle",
            status_code=404,
        )

    def test_api_routes_keep_json_responses(self):
        for path in (
            "/api/users/profile/",
            "/api/notes/",
            "/api/videos/",
            "/api/folders/",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)
                self.assertTrue(
                    response["Content-Type"].startswith("application/json")
                )

    def test_missing_frontend_build_reports_a_server_error(self):
        with override_settings(
            DASHBOARD_BUILD_DIR=Path(self.build_dir.name) / "missing"
        ):
            response = self.client.get("/")

        self.assertEqual(response.status_code, 500)
        self.assertContains(response, "dashboard build is missing", status_code=500)

    def test_dashboard_static_files_are_discoverable(self):
        static_dir = Path(self.build_dir.name) / "static"
        assets_dir = static_dir / "dashboard" / "assets"
        assets_dir.mkdir(parents=True)
        asset = assets_dir / "dashboard.js"
        asset.write_text("window.dashboardReady = true;", encoding="utf-8")
        with override_settings(STATICFILES_DIRS=[static_dir]):
            found = finders.find("dashboard/assets/dashboard.js")

        self.assertEqual(found, str(asset))
