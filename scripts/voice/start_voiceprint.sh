#!/bin/bash
# Start the OmniState voiceprint service in a virtual environment.
# Usage: ./start_voiceprint.sh [--port PORT]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
  echo "[voiceprint] Creating Python virtual environment at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
  # shellcheck source=/dev/null
  source "$VENV_DIR/bin/activate"
  pip install --upgrade pip --quiet
  pip install -r "$SCRIPT_DIR/requirements-voiceprint.txt"
else
  # shellcheck source=/dev/null
  source "$VENV_DIR/bin/activate"
fi

echo "[voiceprint] Starting voiceprint service..."
exec python3 "$SCRIPT_DIR/voiceprint_service.py" "$@"
