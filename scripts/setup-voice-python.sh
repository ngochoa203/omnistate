#!/usr/bin/env bash
set -euo pipefail

PYTHON="python3"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv-voice"

PREFETCH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --python)
      PYTHON="$2"; shift 2 ;;
    --prefetch)
      PREFETCH=1; shift ;;
    *)
      echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating venv at $VENV_DIR …"
  "$PYTHON" -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install -r "$SCRIPT_DIR/requirements.txt"
PYTHON_BIN="$VENV_DIR/bin/python"

echo ""
echo "Note: first use of whisper-local will download the model (~500MB for 'small')."
echo "      Set WHISPER_MODEL to choose a different size (tiny/base/small/medium/large)."

if [[ "$PREFETCH" -eq 1 ]]; then
  WHISPER_MODEL="${WHISPER_MODEL:-small}"
  echo "Pre-fetching whisper model '$WHISPER_MODEL' …"
  "$PYTHON_BIN" -c "from faster_whisper import WhisperModel; WhisperModel('$WHISPER_MODEL', device='cpu')"
  echo "Model '$WHISPER_MODEL' cached."
fi

echo ""
echo "✅ Voice Python env ready."
echo "   Set the interpreter:"
echo "   export OMNISTATE_RTC_PYTHON=$PYTHON_BIN"
