#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Building OmniState macOS app (debug)..."
swift build 2>&1

echo ""
echo "Launching OmniState..."
exec .build/debug/OmniState
