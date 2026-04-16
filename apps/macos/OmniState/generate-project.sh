#!/bin/bash
# Generate OmniState.xcodeproj from project.yml using XcodeGen
#
# Prerequisites:
#   brew install xcodegen
#
# Usage:
#   cd apps/macos/OmniState
#   ./generate-project.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for xcodegen
if ! command -v xcodegen &> /dev/null; then
    echo "Error: xcodegen not found. Install with: brew install xcodegen"
    exit 1
fi

echo "Generating OmniState.xcodeproj..."
xcodegen generate --spec project.yml

echo ""
echo "Done! Open with:"
echo "  open OmniState.xcodeproj"
echo ""
echo "Or build from command line:"
echo "  xcodebuild -project OmniState.xcodeproj -scheme OmniState -configuration Release build"
