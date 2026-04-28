#!/usr/bin/env bash
# install_wake_deps.sh — Install Python deps for openWakeWord engine.
# Idempotent: skips packages already importable.
set -euo pipefail

PYTHON="${OMNISTATE_WAKE_PYTHON:-python3}"

echo "==> Using Python: $($PYTHON --version 2>&1)"

# Check each package; only install missing ones.
PACKAGES=(openwakeword speechbrain torch torchaudio sounddevice numpy speech_recognition requests librosa pvporcupine)
TO_INSTALL=()

for pkg in "${PACKAGES[@]}"; do
  import_name="${pkg//-/_}"
  # speech_recognition imports as speech_recognition
  if ! "$PYTHON" -c "import ${import_name}" 2>/dev/null; then
    TO_INSTALL+=("$pkg")
  else
    echo "  [skip] $pkg already installed"
  fi
done

if [ ${#TO_INSTALL[@]} -eq 0 ]; then
  echo "==> All packages already installed."
else
  echo "==> Installing: ${TO_INSTALL[*]}"
  "$PYTHON" -m pip install --upgrade "${TO_INSTALL[@]}"
fi

# Verify all imports succeed.
echo "==> Verifying imports..."
FAILED=0
for pkg in "${PACKAGES[@]}"; do
  import_name="${pkg//-/_}"
  if "$PYTHON" -c "import ${import_name}" 2>/dev/null; then
    echo "  [OK] $pkg"
  else
    echo "  [FAIL] $pkg — import failed after install"
    FAILED=1
  fi
done

if [ "$FAILED" -eq 1 ]; then
  echo ""
  echo "Some packages failed to import. Common fixes:"
  echo "  PyAudio/sounddevice on macOS: brew install portaudio && pip install sounddevice"
  echo "  torch on Apple Silicon: pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu"
  echo "  openwakeword on Apple Silicon: pip install openwakeword  (uses onnxruntime, no GPU needed)"
  exit 1
fi

echo ""
echo "OK — all dependencies installed and verified."
