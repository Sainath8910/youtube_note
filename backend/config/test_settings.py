import os

os.environ.update(
    {
        "DJANGO_ENV": "test",
        "DEBUG": "false",
        "SECRET_KEY": "playlist-test-only-secret",
        "DB_NAME": "playlist_test",
        "DB_USER": "playlist_test",
        "DB_PASSWORD": "playlist_test",
        "DB_HOST": "127.0.0.1",
        "DB_PORT": "5432",
        "SUPABASE_URL": "https://playlist-test.supabase.co",
        "SUPABASE_JWT_AUDIENCE": "authenticated",
        "SUPABASE_JWT_SECRET": "playlist-test-signing-key-only",
    }
)

from .settings import *  # noqa: E402,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}
