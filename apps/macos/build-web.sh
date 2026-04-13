#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Building web UI..."
cd "$PROJECT_ROOT"
pnpm --filter web build

echo "Copying web assets to app bundle..."
DEST="$SCRIPT_DIR/OmniState/OmniState/Resources/web-dist"
rm -rf "$DEST"
cp -r "$PROJECT_ROOT/packages/web/dist" "$DEST"

echo "Web UI build complete: $DEST"
ls -la "$DEST" | head -10
