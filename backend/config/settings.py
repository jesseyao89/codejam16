"""
Django settings for the Brim AP Automation backend.

Conventions for this project live in AGENTS.md, docs/brief.md and
docs/API_CONTRACT.md. Keep money/limits/state-transitions deterministic;
AI is for extraction/coding/suggestions only.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from backend/.env (gitignored).
load_dotenv(BASE_DIR / ".env")


# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "django-insecure-dev-only-change-me",
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() in ("1", "true", "yes")
# Production security settings
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# Render terminates HTTPS at its reverse proxy
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Enforce HTTPS in production
SECURE_SSL_REDIRECT = not DEBUG

# Enable HSTS after confirming the production domain works over HTTPS
SECURE_HSTS_SECONDS = 0

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

# Allow requests from the React frontend
CORS_ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:5176",
    ).split(",")
    if origin.strip()
]

# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
        # Third party
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    # Local
    "apps.accounts",
    "apps.vendors",
    "apps.invoices",
    "apps.inbox",
    "apps.approvals",
    "apps.payments",
    "apps.audit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

import dj_database_url

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Custom user model. MUST be set before the first migration (AGENTS.md §3).
AUTH_USER_MODEL = "accounts.User"

# Demo auth: every seeded user shares this fake password (docs/DEMO_USERS.md,
# docs/API_CONTRACT.md §2.1). Synthetic data only — never reuse outside the demo.
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo1234")


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Uploaded invoices are kept on disk but never served publicly or serialized raw
# (AGENTS.md §8). Keep this directory out of Git.
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Django REST Framework
# https://www.django-rest-framework.org/api-guide/settings/

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # Contract: `Authorization: Bearer <token>` (docs/API_CONTRACT.md §2).
        "apps.accounts.authentication.BearerTokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.BasicAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Every 4xx/5xx returns the contract error envelope (docs/API_CONTRACT.md §1.2).
    "EXCEPTION_HANDLER": "apps.accounts.exceptions.api_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "config.pagination.RelativePageNumberPagination",
    "PAGE_SIZE": 25,
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}


# Location of the AP dataset. Configurable via DATA_DIR (AGENTS.md §8).
# Relative paths are resolved from the backend/ directory.
DATA_DIR = Path(
    os.environ.get("DATA_DIR", BASE_DIR.parent / "datasets" / "brim_ap_dataset")
)

# Optional override for the inbox attachment directory. When unset, the inbox
# service uses DATA_DIR/incoming_invoices at request time (so DATA_DIR overrides
# are respected).
INBOX_ATTACHMENT_DIR = os.environ.get("INBOX_ATTACHMENT_DIR")
