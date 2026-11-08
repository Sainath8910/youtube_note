import os
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch


SETTINGS_PATH = Path(__file__).resolve().parents[1] / "config" / "settings.py"


def load_settings(**overrides):
    environment = {
        "SECRET_KEY": "test-only-secret-key",
        "DB_NAME": "test",
        "DB_USER": "test",
        "DB_PASSWORD": "test",
        "DB_HOST": "db.example.test",
        "DB_PORT": "5432",
    }
    environment.update(overrides)
    with patch.dict(os.environ, environment, clear=True):
        with patch("dotenv.load_dotenv"):
            return runpy.run_path(str(SETTINGS_PATH))


class RenderSettingsTests(unittest.TestCase):
    def test_render_and_additional_hosts_are_allowed_without_dropping_local_hosts(self):
        settings = load_settings(
            RENDER_EXTERNAL_HOSTNAME="youtube-notes.onrender.com",
            EXTRA_ALLOWED_HOSTS="api.example.test, dashboard.example.test",
        )

        self.assertIn("youtube-notes.onrender.com", settings["ALLOWED_HOSTS"])
        self.assertIn("api.example.test", settings["ALLOWED_HOSTS"])
        self.assertIn("dashboard.example.test", settings["ALLOWED_HOSTS"])
        self.assertIn("localhost", settings["ALLOWED_HOSTS"])
        self.assertIn("127.0.0.1", settings["ALLOWED_HOSTS"])
        self.assertIn("testserver", settings["ALLOWED_HOSTS"])

    def test_production_defaults_are_secure_and_static_files_use_whitenoise(self):
        settings = load_settings(
            RENDER_EXTERNAL_HOSTNAME="youtube-notes.onrender.com",
            DJANGO_ENV="production",
            ENABLE_DEV_HEADER_AUTH="true",
        )

        self.assertFalse(settings["DEBUG"])
        self.assertFalse(settings["ENABLE_DEV_HEADER_AUTH"])
        self.assertTrue(settings["SESSION_COOKIE_SECURE"])
        self.assertTrue(settings["CSRF_COOKIE_SECURE"])
        self.assertEqual(settings["STATIC_URL"], "/static/")
        self.assertEqual(settings["STATIC_ROOT"], settings["BASE_DIR"] / "staticfiles")
        self.assertEqual(
            settings["STORAGES"]["staticfiles"]["BACKEND"],
            "whitenoise.storage.CompressedManifestStaticFilesStorage",
        )
        self.assertEqual(
            settings["SECURE_PROXY_SSL_HEADER"],
            ("HTTP_X_FORWARDED_PROTO", "https"),
        )
        security_index = settings["MIDDLEWARE"].index(
            "django.middleware.security.SecurityMiddleware"
        )
        self.assertEqual(
            settings["MIDDLEWARE"][security_index + 1],
            "whitenoise.middleware.WhiteNoiseMiddleware",
        )

    def test_local_development_keeps_insecure_cookies(self):
        settings = load_settings(
            DJANGO_ENV="development",
            DEBUG="true",
            ENABLE_DEV_HEADER_AUTH="true",
        )

        self.assertTrue(settings["DEBUG"])
        self.assertTrue(settings["ENABLE_DEV_HEADER_AUTH"])
        self.assertFalse(settings["SESSION_COOKIE_SECURE"])
        self.assertFalse(settings["CSRF_COOKIE_SECURE"])
        self.assertIn("localhost", settings["ALLOWED_HOSTS"])


if __name__ == "__main__":
    unittest.main()
