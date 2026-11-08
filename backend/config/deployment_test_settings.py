import os

os.environ.update(
    {
        "DJANGO_ENV": "test",
        "DEBUG": "false",
        "SECRET_KEY": "deployment-test-only-key",
        "DB_NAME": "deployment_test",
        "DB_USER": "deployment_test",
        "DB_PASSWORD": "deployment_test",
        "DB_HOST": "database.invalid",
        "DB_PORT": "5432",
    }
)

from .settings import *  # noqa: E402,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}
