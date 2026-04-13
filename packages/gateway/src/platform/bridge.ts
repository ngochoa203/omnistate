/**
 * Native Bridge — loads the Rust N-API .node binary and wraps
 * all native functions with TypeScript-friendly APIs.
 *
 * The .node binary is built from `crates/omnistate-napi/` and contains:
 * - Screen capture (traditional CGDisplay + zero-copy IOSurface)
 * - Mouse & keyboard control (CGEvent-based)
 * - Accessibility tree walking (AXUIElement)
 *
 * ## Build
 *
 * ```bash
 * pnpm build:native
 * # or manually:
 * cargo build -p omnistate-napi --release
 * node scripts/copy-native.mjs
 * ```
 */

import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------
// Type declarations for the N-API exports
// ------------------------------------------------------------------

interface NativeBindings {
  // Screen capture (omnistate-screen — CGDisplay based)
  captureScreen(): {
    width: number;
    height: number;
    bytesPerPixel: number;
    timestampNs: string;
    captureMethod: string;
    dataLength: number;
  };
  captureWindow(windowId: number): {
    width: number;
    height: number;
    bytesPerPixel: number;
    timestampNs: string;
    captureMethod: string;
    dataLength: number;
  };
  captureRegion(
    x: number,
    y: number,
    width: number,
    height: number
  ): {
    width: number;
    height: number;
    bytesPerPixel: number;
    timestampNs: string;
    captureMethod: string;
    dataLength: number;
  };
  captureScreenBuffer(): Buffer;
  listWindows(): Array<{
    id: number;
    title: string;
    owner: string;
    bounds: { x: number; y: number; width: number; height: number };
    isOnScreen: boolean;
  }>;

  // Zero-copy GPU capture (omnistate-capture — IOSurface based)
  captureFrameZeroCopy(): {
    width: number;
    height: number;
    bytesPerRow: number;
    pixelFormat: string;
    dataLength: number;
    captureMethod: string;
  };
  captureFrameZeroCopyBuffer(): Buffer;
  captureFrameConfigured(
    width: number,
    height: number,
    showCursor: boolean,
    pixelFormat: string
  ): {
    width: number;
    height: number;
    bytesPerRow: number;
    pixelFormat: string;
    dataLength: number;
    captureMethod: string;
  };

  // Input control (omnistate-input — CGEvent based)
  moveMouse(x: number, y: number): void;
  moveMouseSmooth(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    steps: number
  ): void;
  click(button: string): void;
  doubleClick(button: string): void;
  scroll(dx: number, dy: number): void;
  drag(fromX: number, fromY: number, toX: number, toY: number): void;
  keyTap(
    key: string,
    shift: boolean,
    control: boolean,
    alt: boolean,
    meta: boolean
  ): void;
  keyDown(
    key: string,
    shift: boolean,
    control: boolean,
    alt: boolean,
    meta: boolean
  ): void;
  keyUp(
    key: string,
    shift: boolean,
    control: boolean,
    alt: boolean,
    meta: boolean
  ): void;
  typeText(text: string): void;

  // Accessibility (omnistate-a11y — AXUIElement based)
  isAccessibilityTrusted(): boolean;
  getUiElements(): unknown;
  findElement(query: string): unknown;
  getUiTree(): unknown;
}

// ------------------------------------------------------------------
// Load the native binary
// ------------------------------------------------------------------

const require = createRequire(import.meta.url);

function resolveNativeModule(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  const filename = `omnistate.${platform}-${arch}.node`;

  // Search paths (in priority order)
  const searchPaths = [
    // 1. packages/gateway/native/ (build output)
    join(__dirname, "..", "..", "native", filename),
    // 2. Project root target/release (development shortcut)
    join(__dirname, "..", "..", "..", "..", "target", "release", getLibName()),
  ];

  for (const p of searchPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

function getLibName(): string {
  switch (process.platform) {
    case "darwin":
      return "libomnistate_napi.dylib";
    case "win32":
      return "omnistate_napi.dll";
    default:
      return "libomnistate_napi.so";
  }
}

let _native: NativeBindings | null = null;
let _loadError: string | null = null;

function loadNative(): NativeBindings | null {
  if (_native) return _native;
  if (_loadError) return null;

  const modulePath = resolveNativeModule();
  if (!modulePath) {
    _loadError =
      "Native binary not found. Run 'pnpm build:native' to build it.";
    return null;
  }

  try {
    _native = require(modulePath) as NativeBindings;
    return _native;
  } catch (e) {
    _loadError = `Failed to load native binary: ${e}`;
    return null;
  }
}

// ------------------------------------------------------------------
// Public API — thin wrappers that gracefully handle missing native
// ------------------------------------------------------------------

function getNative(): NativeBindings {
  const n = loadNative();
  if (!n) {
    throw new Error(_loadError ?? "Native bindings not available");
  }
  return n;
}

/** Check if native bindings are available. */
export function isNativeAvailable(): boolean {
  return loadNative() !== null;
}

/** Get the native load error, if any. */
export function getNativeError(): string | null {
  loadNative(); // trigger load attempt
  return _loadError;
}

// --- Screen Capture ---

export function captureScreen() {
  return getNative().captureScreen();
}

export function captureWindow(windowId: number) {
  return getNative().captureWindow(windowId);
}

export function captureRegion(
  x: number,
  y: number,
  width: number,
  height: number
) {
  return getNative().captureRegion(x, y, width, height);
}

export function captureScreenBuffer(): Buffer {
  return getNative().captureScreenBuffer();
}

export function listWindows() {
  return getNative().listWindows();
}

// --- Zero-Copy GPU Capture ---

export function captureFrameZeroCopy() {
  return getNative().captureFrameZeroCopy();
}

export function captureFrameZeroCopyBuffer(): Buffer {
  return getNative().captureFrameZeroCopyBuffer();
}

export function captureFrameConfigured(
  width: number,
  height: number,
  showCursor: boolean,
  pixelFormat: string = "bgra8"
) {
  return getNative().captureFrameConfigured(
    width,
    height,
    showCursor,
    pixelFormat
  );
}

// --- Input Control ---

export function moveMouse(x: number, y: number) {
  getNative().moveMouse(x, y);
}

export function moveMouseSmooth(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps: number = 20
) {
  getNative().moveMouseSmooth(fromX, fromY, toX, toY, steps);
}

export function click(button: "left" | "right" | "middle" = "left") {
  getNative().click(button);
}

export function doubleClick(button: "left" | "right" | "middle" = "left") {
  getNative().doubleClick(button);
}

export function scroll(dx: number, dy: number) {
  getNative().scroll(dx, dy);
}

export function drag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
) {
  getNative().drag(fromX, fromY, toX, toY);
}

export function keyTap(
  key: string,
  modifiers: {
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
  } = {}
) {
  getNative().keyTap(
    key,
    modifiers.shift ?? false,
    modifiers.control ?? false,
    modifiers.alt ?? false,
    modifiers.meta ?? false
  );
}

export function keyDown(
  key: string,
  modifiers: {
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
  } = {}
) {
  getNative().keyDown(
    key,
    modifiers.shift ?? false,
    modifiers.control ?? false,
    modifiers.alt ?? false,
    modifiers.meta ?? false
  );
}

export function keyUp(
  key: string,
  modifiers: {
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
  } = {}
) {
  getNative().keyUp(
    key,
    modifiers.shift ?? false,
    modifiers.control ?? false,
    modifiers.alt ?? false,
    modifiers.meta ?? false
  );
}

export function typeText(text: string) {
  getNative().typeText(text);
}

// --- Accessibility ---

export function isAccessibilityTrusted(): boolean {
  return getNative().isAccessibilityTrusted();
}

export function getUiElements() {
  return getNative().getUiElements();
}

export function findElement(query: string) {
  return getNative().findElement(query);
}

export function getUiTree() {
  const native = loadNative();
  if (!native?.getUiTree) return null;
  return native.getUiTree();
}
