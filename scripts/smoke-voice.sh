#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR=$(mktemp -d)
trap 'rm -rf "$PROFILE_DIR"' EXIT

export OMNISTATE_ENROLL_MOCK=1
export OMNISTATE_RTC_PROFILE_DIR="$PROFILE_DIR"

echo "→ Running gateway voice tests (mock mode)..."
pnpm -C packages/gateway test -- --reporter=verbose voice

echo "→ Typechecking gateway..."
npx tsc --noEmit -p packages/gateway/tsconfig.json

echo "→ Typechecking web..."
npx tsc --noEmit -p packages/web/tsconfig.json

# Keep dir alive long enough to print path (trap fires on exit, so cancel it)
trap - EXIT

echo ""
printf '\033[0;32mVOICE SMOKE OK\033[0m — profile dir: %s (inspect before it is removed)\n' "$PROFILE_DIR"
echo "  To inspect: ls -la $PROFILE_DIR"

rm -rf "$PROFILE_DIR"

# ---------------------------------------------------------------------------
# Runtime health checks (requires gateway running at localhost:19800)
# ---------------------------------------------------------------------------
BASE="http://localhost:19800"

echo ""
echo "=== Gateway Runtime Smoke ==="

# 1. Health check
echo -n "[1] Health: "
if curl -fs "${BASE}/health" -o /dev/null 2>/dev/null; then
  echo "OK"
else
  echo "SKIP — gateway not running at ${BASE}"
  exit 0
fi

# 2. Wake status
echo "[2] Wake status:"
curl -fs "${BASE}/api/wake/status" 2>/dev/null | jq . 2>/dev/null || echo "  (no response)"

# 3. Voice profile endpoint
echo "[3] Voice profile:"
curl -fs "${BASE}/api/voice/profile" 2>/dev/null | jq . 2>/dev/null || echo "  no profile endpoint"

# 4. Summary
echo ""
echo "=== Summary ==="
HEALTH_JSON=$(curl -fs "${BASE}/health" 2>/dev/null || echo "{}")
WAKE_JSON=$(curl -fs "${BASE}/api/wake/status" 2>/dev/null || echo "{}")

VERSION=$(echo "$HEALTH_JSON"    | jq -r '.version // "unknown"' 2>/dev/null || echo "unknown")
WAKE_ENGINE=$(echo "$WAKE_JSON"  | jq -r '.engine // .wakeEngine // "unknown"' 2>/dev/null || echo "unknown")
MODEL_OK=$(echo "$WAKE_JSON"     | jq -r '.modelInstalled // .model_installed // "unknown"' 2>/dev/null || echo "unknown")

PROFILE_STATUS="none"
if curl -fs "${BASE}/api/voice/profile" -o /dev/null 2>/dev/null; then
  PROFILE_STATUS="present"
fi

echo "  Gateway version : ${VERSION}"
echo "  Wake engine     : ${WAKE_ENGINE}"
echo "  Model installed : ${MODEL_OK}"
echo "  Voice profile   : ${PROFILE_STATUS}"
