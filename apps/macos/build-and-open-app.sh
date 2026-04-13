#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_ROOT="$SCRIPT_DIR/OmniState"
APP_NAME="OmniState"
APP_BUNDLE_ID="com.omnistate.app"
DIST_APP="$APP_ROOT/dist/$APP_NAME.app"
CONTENTS_DIR="$DIST_APP/Contents"

echo "[1/5] Build web assets"
bash "$SCRIPT_DIR/build-web.sh"

echo "[2/5] Build release binary"
swift build -c release --package-path "$APP_ROOT"

echo "[3/5] Package .app bundle"
rm -rf "$DIST_APP"
mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources"
cp "$APP_ROOT/.build/release/$APP_NAME" "$CONTENTS_DIR/MacOS/$APP_NAME"
chmod +x "$CONTENTS_DIR/MacOS/$APP_NAME"

sed \
  -e "s|\$(EXECUTABLE_NAME)|$APP_NAME|g" \
  -e "s|\$(PRODUCT_BUNDLE_IDENTIFIER)|$APP_BUNDLE_ID|g" \
  -e "s|\$(PRODUCT_NAME)|$APP_NAME|g" \
  "$APP_ROOT/OmniState/Info.plist" > "$CONTENTS_DIR/Info.plist"

cp -R "$APP_ROOT/OmniState/Resources/." "$CONTENTS_DIR/Resources/"

echo "[4/5] Codesign (ad-hoc)"
codesign --force --deep --sign - "$DIST_APP"

plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null
codesign --verify --deep --strict "$DIST_APP"

echo "[5/5] Open app"
open "$DIST_APP"

echo "Done: $DIST_APP"
