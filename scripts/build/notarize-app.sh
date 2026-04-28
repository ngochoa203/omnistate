#!/usr/bin/env bash
# Notarize the OmniState.app bundle for distribution.
# Usage: ./scripts/notarize-app.sh <path-to-app> <apple-id> <team-id> <app-password>
#
# Requires: signed app bundle, Apple Developer account, app-specific password.
# Create app-specific password at: https://appleid.apple.com/account/manage

set -euo pipefail

APP_PATH="${1:-}"
APPLE_ID="${2:-}"
TEAM_ID="${3:-}"
APP_PASSWORD="${4:-}"

if [ -z "$APP_PATH" ] || [ -z "$APPLE_ID" ] || [ -z "$TEAM_ID" ] || [ -z "$APP_PASSWORD" ]; then
    echo "Usage: $0 <path-to-app.zip> <apple-id> <team-id> <app-password>"
    echo ""
    echo "Example:"
    echo "  $0 OmniState.app.zip your@email.com ABCDEF1234 xxxx-xxxx-xxxx-xxxx"
    exit 1
fi

# Step 1: Create ZIP if app path is a .app directory
if [ -d "$APP_PATH" ] && [[ "$APP_PATH" == *.app ]]; then
    ZIP_PATH="${APP_PATH%.app}.zip"
    echo "Creating ZIP archive..."
    ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
    APP_PATH="$ZIP_PATH"
fi

# Step 2: Submit for notarization
echo "Submitting for notarization..."
SUBMISSION=$(xcrun notarytool submit "$APP_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$TEAM_ID" \
    --password "$APP_PASSWORD" \
    --output-format json \
    --wait 2>&1)

echo "$SUBMISSION" | python3 -m json.tool 2>/dev/null || echo "$SUBMISSION"

# Step 3: Check result
STATUS=$(echo "$SUBMISSION" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")

if [ "$STATUS" = "Accepted" ]; then
    echo "Notarization successful!"

    # Step 4: Staple the ticket
    if [[ "$APP_PATH" == *.app ]]; then
        echo "Stapling ticket..."
        xcrun stapler staple "$APP_PATH"
        echo "Stapled successfully"
    else
        echo "INFO: Staple the .app bundle manually: xcrun stapler staple YourApp.app"
    fi
else
    echo "ERROR: Notarization failed with status: $STATUS"
    # Get detailed log
    ID=$(echo "$SUBMISSION" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    if [ -n "$ID" ]; then
        echo "Detailed log:"
        xcrun notarytool log "$ID" \
            --apple-id "$APPLE_ID" \
            --team-id "$TEAM_ID" \
            --password "$APP_PASSWORD"
    fi
    exit 1
fi
