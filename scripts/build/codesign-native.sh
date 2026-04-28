#!/usr/bin/env bash
# Codesign all native binaries (.node, .dylib) for macOS distribution.
# Usage: ./scripts/codesign-native.sh [signing-identity]
#
# If no identity is given, uses ad-hoc signing (-)
# For distribution, pass your Apple Developer ID:
#   ./scripts/codesign-native.sh "Developer ID Application: Your Name (TEAMID)"

set -euo pipefail

IDENTITY="${1:--}"
ENTITLEMENTS="apps/macos/OmniState/OmniState.entitlements"

echo "Codesigning native binaries with identity: $IDENTITY"

# Find all .node and .dylib files in the build output
BINARIES=(
    $(find packages/gateway -name "*.node" -type f 2>/dev/null)
    $(find target/release -name "*.dylib" -type f 2>/dev/null)
)

if [ ${#BINARIES[@]} -eq 0 ]; then
    echo "WARNING: No native binaries found. Run 'cargo build --release' first."
    exit 1
fi

for binary in "${BINARIES[@]}"; do
    echo "  Signing: $binary"
    codesign --deep --force --options runtime \
        --sign "$IDENTITY" \
        --entitlements "$ENTITLEMENTS" \
        --timestamp \
        "$binary"
done

echo "Signed ${#BINARIES[@]} binaries"

# Verify signatures
echo ""
echo "Verifying signatures..."
for binary in "${BINARIES[@]}"; do
    if codesign --verify --verbose=2 "$binary" 2>&1 | grep -q "valid on disk"; then
        echo "  OK: $binary"
    else
        echo "  FAIL: $binary -- verification failed!"
        codesign --verify --verbose=2 "$binary"
    fi
done
