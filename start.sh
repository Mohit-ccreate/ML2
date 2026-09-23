#!/usr/bin/env bash
# One-command OptionEdge dashboard startup (survives sandbox restarts, which
# wipe the Python venv). Rebuilds the venv if missing, then starts the server.
set -e
VENV=/home/user/.venv
cd "$(dirname "$0")"

if [ ! -x "$VENV/bin/python" ]; then
  echo "venv missing - rebuilding (takes ~3-5 min)..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q flask numpy pandas matplotlib scipy scikit-learn xgboost torch
fi

echo "starting OptionEdge dashboard on :8000 ..."
exec "$VENV/bin/python" dashboard/app.py
