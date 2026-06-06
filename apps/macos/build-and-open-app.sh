#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_ROOT="$SCRIPT_DIR/OmniState"
APP_NAME="OmniState"
APP_BUNDLE_ID="com.omnistate.app"
DIST_APP="$APP_ROOT/dist/$APP_NAME.app"
CONTENTS_DIR="$DIST_APP/Contents"
RUNTIME_DIR="$CONTENTS_DIR/Resources/runtime"
NODE_BIN="${NODE_BINARY:-$(command -v node || true)}"
LIB_DIR="$RUNTIME_DIR/lib"
GATEWAY_STAGE_ROOT=""

stage_gateway_runtime() {
    local stage_root
    local deploy_root
    stage_root="$(mktemp -d /tmp/omnistate-gateway-stage.XXXXXX)"
    deploy_root="$(mktemp -d /tmp/omnistate-gateway-deploy.XXXXXX)"
    GATEWAY_STAGE_ROOT="$stage_root"

    mkdir -p "$stage_root/packages"
    rsync -a "$PROJECT_ROOT/package.json" "$PROJECT_ROOT/pnpm-lock.yaml" "$PROJECT_ROOT/pnpm-workspace.yaml" "$stage_root/"
    rsync -a "$PROJECT_ROOT/packages/gateway" "$stage_root/packages/"
    rsync -a "$PROJECT_ROOT/packages/shared" "$stage_root/packages/"

    pnpm --dir "$stage_root" --filter @omnistate/gateway deploy --prod --legacy "$deploy_root" >&2
    rm -rf "$deploy_root/.omnistate" \
           "$deploy_root/src" \
           "$deploy_root/scripts" \
           "$deploy_root/test-zalo.ts" \
           "$deploy_root/tsconfig.json" \
           "$deploy_root/vitest.config.ts" \
           "$deploy_root/.env.example"
    rm -f "$deploy_root/node_modules/@omnistate/gateway" \
          "$deploy_root/node_modules/.pnpm/node_modules/@omnistate/gateway"
    find "$deploy_root/dist" -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js.map' \) -delete

    printf '%s\n' "$deploy_root"
}

resolve_node_dependency() {
    local dep="$1"
    local parent="$2"
    local resolved="$dep"

    if [[ "$dep" == @rpath/* ]]; then
        resolved="$(cd "$(dirname "$NODE_BIN")/../lib" && pwd)/${dep#@rpath/}"
    elif [[ "$dep" == @loader_path/* ]]; then
        resolved="$(cd "$(dirname "$parent")" && pwd)/${dep#@loader_path/}"
    fi

    printf '%s\n' "$resolved"
}

copy_node_dependency() {
    local dep="$1"
    local parent="$2"
    local resolved
    resolved="$(resolve_node_dependency "$dep" "$parent")"

    if [[ "$resolved" == /System/* || "$resolved" == /usr/lib/* ]]; then
        return
    fi

    if [[ ! -f "$resolved" ]]; then
        echo "Warning: node dependency not found: $dep -> $resolved" >&2
        return
    fi

    local dest="$LIB_DIR/$(basename "$resolved")"
    if [[ -e "$dest" ]]; then
        return
    fi

    cp -RL "$resolved" "$dest"

    while IFS= read -r child; do
        [[ -z "$child" ]] && continue
        copy_node_dependency "$child" "$resolved"
    done < <(otool -L "$resolved" | tail -n +2 | awk '{print $1}')
}

rewrite_macho_paths() {
    local target="$1"
    local mode="$2"
    local target_name
    target_name="$(basename "$target")"

    if [[ "$mode" == "dylib" ]]; then
        install_name_tool -id "@loader_path/$target_name" "$target"
    fi

    while IFS= read -r dep; do
        [[ -z "$dep" ]] && continue

        if [[ "$dep" == /System/* || "$dep" == /usr/lib/* ]]; then
            continue
        fi

        local resolved
        resolved="$(resolve_node_dependency "$dep" "$target")"
        local dep_name
        dep_name="$(basename "$resolved")"
        local bundled_dep="$LIB_DIR/$dep_name"

        if [[ -f "$bundled_dep" ]]; then
            if [[ "$mode" == "node" ]]; then
                install_name_tool -change "$dep" "@executable_path/../lib/$dep_name" "$target"
            else
                install_name_tool -change "$dep" "@loader_path/$dep_name" "$target"
            fi
        fi
    done < <(otool -L "$target" | tail -n +2 | awk '{print $1}')
}

echo "[0/6] Reset app permissions"
pkill -x "$APP_NAME" >/dev/null 2>&1 || true
tccutil reset All "$APP_BUNDLE_ID" >/dev/null 2>&1 || true
defaults delete "$APP_BUNDLE_ID" omnistate.didCompleteFullPermissions >/dev/null 2>&1 || true
defaults delete "$APP_BUNDLE_ID" omnistate.lastPermissionPromptAt >/dev/null 2>&1 || true

echo "[1/6] Build web assets"
echo "Skipping web asset build (native UI mode)"

echo "[2/6] Build gateway and native runtime"
pnpm --dir "$PROJECT_ROOT" app:build:gateway
pnpm --dir "$PROJECT_ROOT" build:native

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    echo "Node binary not found. Set NODE_BINARY=/absolute/path/to/node or ensure node is in PATH." >&2
    exit 1
fi

echo "[3/6] Build release binary (native)"
swift build -c release --package-path "$APP_ROOT"

echo "[4/6] Package .app bundle"
chmod -R u+w "$DIST_APP" 2>/dev/null || true
rm -rf "$DIST_APP"
mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources" "$RUNTIME_DIR"
cp "$APP_ROOT/.build/release/$APP_NAME" "$CONTENTS_DIR/MacOS/$APP_NAME"
chmod +x "$CONTENTS_DIR/MacOS/$APP_NAME"

# Bundle the gateway runtime into the app so it works without dev-machine paths.
# Layout: OmniState.app/Contents/Resources/runtime/gateway/dist/<...>
GATEWAY_DIST_SRC="$PROJECT_ROOT/packages/gateway/dist"
GATEWAY_RUNTIME_STAGE="$(stage_gateway_runtime)"
GATEWAY_RUNTIME_DST="$RUNTIME_DIR/gateway"
if [ -d "$GATEWAY_DIST_SRC" ]; then
    mkdir -p "$GATEWAY_RUNTIME_DST"
    rsync -a "$GATEWAY_RUNTIME_STAGE/" "$GATEWAY_RUNTIME_DST/"
    rm -rf "$GATEWAY_RUNTIME_STAGE" "$GATEWAY_STAGE_ROOT"
    echo "[4/6] Bundled gateway runtime: $(find "$GATEWAY_RUNTIME_DST" -type f | wc -l | xargs) files"
else
    echo "[4/6] WARNING: $GATEWAY_DIST_SRC not found — gateway will not be bundled."
    echo "        Run 'pnpm --filter gateway build' to build it, then re-run this script."
fi

mkdir -p "$RUNTIME_DIR/bin"
cp "$NODE_BIN" "$RUNTIME_DIR/bin/node"
chmod +x "$RUNTIME_DIR/bin/node"
mkdir -p "$LIB_DIR"
while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    copy_node_dependency "$dep" "$NODE_BIN"
done < <(otool -L "$NODE_BIN" | tail -n +2 | awk '{print $1}')
find "$LIB_DIR" -maxdepth 1 -type f -name '*.dylib' -print0 | while IFS= read -r -d '' dylib; do
    rewrite_macho_paths "$dylib" "dylib"
done
rewrite_macho_paths "$RUNTIME_DIR/bin/node" "node"
install_name_tool -add_rpath "@executable_path/../lib" "$RUNTIME_DIR/bin/node" 2>/dev/null || true
cat > "$RUNTIME_DIR/manifest.json" <<EOF
{
  "gatewayEntry": "gateway/dist/index.js",
  "nodeBinary": "bin/node"
}
EOF

sed \
  -e "s|\$(EXECUTABLE_NAME)|$APP_NAME|g" \
  -e "s|\$(PRODUCT_BUNDLE_IDENTIFIER)|$APP_BUNDLE_ID|g" \
  -e "s|\$(PRODUCT_NAME)|$APP_NAME|g" \
  "$APP_ROOT/OmniState/Info.plist" > "$CONTENTS_DIR/Info.plist"

cp -R "$APP_ROOT/OmniState/Resources/." "$CONTENTS_DIR/Resources/"

echo "[5/6] Codesign (ad-hoc)"
ENTITLEMENTS="$APP_ROOT/OmniState/OmniState.entitlements"
find "$RUNTIME_DIR" -type f \( -name '*.dylib' -o -name '*.node' \) -print0 | while IFS= read -r -d '' nested_code; do
    codesign --force --sign - "$nested_code"
done
codesign --force --sign - "$RUNTIME_DIR/bin/node"
if [ -f "$ENTITLEMENTS" ]; then
    codesign --deep --force --options runtime --sign - --entitlements "$ENTITLEMENTS" "$DIST_APP"
else
    codesign --force --deep --sign - "$DIST_APP"
fi

plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null
codesign --verify --deep --strict "$DIST_APP"

if [ "${SKIP_OPEN:-0}" = "1" ]; then
    echo "[6/6] Skip open (SKIP_OPEN=1)"
else
    echo "[6/6] Open app"
    open "$DIST_APP"
fi

echo "Done: $DIST_APP"
