#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

REPO_ROOT="$(cd .. && pwd)"

python -m pip install -r requirements.txt
npm ci --prefix "$REPO_ROOT/extension"
npm run build:web --prefix "$REPO_ROOT/extension"
python manage.py collectstatic --no-input
python manage.py migrate --noinput
