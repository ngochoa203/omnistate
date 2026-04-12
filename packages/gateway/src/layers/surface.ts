/**
 * Surface Layer — vision-based UI interaction via Rust N-API bindings.
 *
 * Captures the screen using zero-copy GPU framebuffer access (IOSurface),
 * detects UI elements via accessibility API + vision model,
 * and operates mouse/keyboard like a human.
 *
 * Data flow for capture:
 *   GPU framebuffer -> IOSurface (zero-copy) -> Node.js Buffer -> base64 (for vision)
 *
 * Data flow for interaction:
 *   TypeScript command -> N-API -> Rust -> CGEvent/AXUIElement -> macOS
 */

import * as bridge from "../platform/bridge.js";
import { fingerprintTree } from "../vision/fingerprint.js";
import { detectByFingerprint as _detectByFingerprint } from "../vision/detect.js";

export class SurfaceLayer {
  /** Check if the native bridge is available. */
  get isAvailable(): boolean {
    return bridge.isNativeAvailable();
  }

  /**
   * Capture the current screen using zero-copy GPU framebuffer access.
   *
   * On Apple Silicon, this reads directly from GPU unified memory via IOSurface.
   * Returns metadata and the raw pixel buffer.
   */
  async captureScreen(): Promise<ScreenCapture> {
    // Use zero-copy capture (ScreenCaptureKit + IOSurface) as primary path
    try {
      const meta = bridge.captureFrameZeroCopy();
      const buffer = bridge.captureFrameZeroCopyBuffer();
      return {
        width: meta.width,
        height: meta.height,
        data: buffer,
        timestampMs: Date.now(),
        captureMethod: "zero-copy-iosurface",
        bytesPerRow: meta.bytesPerRow,
        pixelFormat: meta.pixelFormat,
      };
    } catch {
      // Fallback to traditional CGDisplay capture
      const meta = bridge.captureScreen();
      const buffer = bridge.captureScreenBuffer();
      return {
        width: meta.width,
        height: meta.height,
        data: buffer,
        timestampMs: Date.now(),
        captureMethod: "cgdisplay",
      };
    }
  }

  /** Capture a specific window by its platform window ID. */
  async captureWindow(windowId: number): Promise<ScreenCapture> {
    const windows = await this.listWindows();
    const target = windows.find((w) => w.id === windowId);
    if (!target) {
      throw new Error(`Window ${windowId} not found`);
    }

    const region = await this.captureRegion(
      target.bounds.x,
      target.bounds.y,
      target.bounds.width,
      target.bounds.height
    );

    return {
      ...region,
      captureMethod: "window",
    };
  }

  /** Capture a rectangular region of the screen. */
  async captureRegion(
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<ScreenCapture> {
    // Native bridge currently exposes metadata-only region capture.
    // Crop from a full-frame buffer so callers always receive real pixels.
    const full = await this.captureScreen();
    const cropped = cropBufferRegion(
      full.data,
      full.width,
      full.height,
      x,
      y,
      width,
      height,
      full.bytesPerRow
    );

    return {
      width: cropped.width,
      height: cropped.height,
      data: cropped.data,
      timestampMs: Date.now(),
      captureMethod: "region",
      bytesPerRow: cropped.width * 4,
      pixelFormat: full.pixelFormat,
    };
  }

  /** List all visible windows on screen. */
  async listWindows(): Promise<WindowInfo[]> {
    const windows = bridge.listWindows();
    return windows;
  }

  /**
   * Find a UI element by description.
   *
   * Priority:
   * 1. Fingerprint store — structural identity match (survives colour/theme changes)
   * 2. Accessibility API (fast, accurate, free)
   * 3. Vision model (slower, costs API call, but understands semantics)
   *
   * Before searching, the accessibility tree is re-walked and all component
   * fingerprints are refreshed so subsequent calls benefit from the latest
   * structural snapshot.
   */
  async findElement(description: string): Promise<DetectedElement | null> {
    // ── Step 1: Refresh the accessibility tree and re-fingerprint ────────────
    try {
      if (bridge.isNativeAvailable()) {
        const rawTree = bridge.getUiTree() as Record<string, unknown> | null | undefined;
        if (rawTree) {
          fingerprintTree(rawTree);
        }
      }
    } catch {
      // Fingerprint refresh failed — continue with stale store or empty store.
    }

    // ── Step 2: Fingerprint-based detection (structural, most reliable) ───────
    const fpResult = _detectByFingerprint(description);
    if (fpResult && fpResult.confidence > 0.5) {
      return fpResult;
    }

    // ── Step 3: Accessibility API direct lookup ───────────────────────────────
    try {
      const element = bridge.findElement(description) as Record<
        string,
        unknown
      > | null;
      if (element) {
        return {
          id: String(element.title ?? ""),
          type: String(element.role ?? "unknown"),
          bounds: element.bounds as {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          text: element.title as string | undefined,
          confidence: 0.95,
          detectionMethod: "accessibility",
        };
      }
    } catch {
      // Accessibility not available — fall through to vision.
    }

    // ── Step 4: Accessibility tree scan (broader text/role match) ────────────
    try {
      if (bridge.isNativeAvailable()) {
        const allElements = bridge.getUiElements() as Array<Record<string, unknown>>;
        const queryLower = description.toLowerCase();
        const matched = allElements.find((el) => {
          const title = String(el.title ?? "").toLowerCase();
          const role = String(el.role ?? "").toLowerCase();
          const isBoundsValid =
            typeof el.bounds === "object" &&
            el.bounds !== null &&
            ["x", "y", "width", "height"].every(
              (k) => typeof (el.bounds as Record<string, unknown>)[k] === "number"
            );
          return (title.includes(queryLower) || role.includes(queryLower)) && isBoundsValid;
        });
        if (matched) {
          return {
            id: String(matched.title ?? ""),
            type: String(matched.role ?? "unknown"),
            bounds: matched.bounds as { x: number; y: number; width: number; height: number },
            text: matched.title as string | undefined,
            confidence: 0.85,
            detectionMethod: "accessibility",
          };
        }
      }
    } catch {
      // Fall through.
    }

    // TODO: Vision model fallback (Sprint 3)
    return null;
  }

  /** Get all UI elements from the accessibility tree. */
  async getUIElements(): Promise<DetectedElement[]> {
    try {
      const elements = bridge.getUiElements() as Array<
        Record<string, unknown>
      >;
      return elements.map((el) => ({
        id: String(el.title ?? ""),
        type: String(el.role ?? "unknown"),
        bounds: el.bounds as {
          x: number;
          y: number;
          width: number;
          height: number;
        },
        text: el.title as string | undefined,
        confidence: 1.0,
        detectionMethod: "accessibility",
      }));
    } catch {
      return [];
    }
  }

  /** Click on a detected element. */
  async clickElement(element: DetectedElement): Promise<void> {
    // Refresh fingerprints so the store reflects the latest UI state.
    try {
      if (bridge.isNativeAvailable()) {
        const rawTree = bridge.getUiTree() as Record<string, unknown> | null | undefined;
        if (rawTree) {
          fingerprintTree(rawTree);
        }
      }
    } catch {
      /* continue with existing state */
    }

    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;

    // Move mouse smoothly to element center (human-like Bezier curve)
    bridge.moveMouseSmooth(
      centerX - 50, // Start slightly off-target
      centerY - 30,
      centerX,
      centerY,
      15 // steps
    );

    // Small delay then click
    await sleep(50);
    bridge.click("left");
  }

  /** Double-click on a detected element. */
  async doubleClickElement(element: DetectedElement): Promise<void> {
    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;

    bridge.moveMouse(centerX, centerY);
    await sleep(30);
    bridge.doubleClick("left");
  }

  /** Move mouse to absolute coordinates. */
  async moveMouse(x: number, y: number): Promise<void> {
    bridge.moveMouse(x, y);
  }

  /** Move mouse smoothly along a Bezier curve. */
  async moveMouseSmooth(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    steps: number = 20
  ): Promise<void> {
    bridge.moveMouseSmooth(fromX, fromY, toX, toY, steps);
  }

  /** Click at current mouse position. */
  async click(button: "left" | "right" | "middle" = "left"): Promise<void> {
    bridge.click(button);
  }

  /** Scroll the mouse wheel. */
  async scroll(dx: number, dy: number): Promise<void> {
    bridge.scroll(dx, dy);
  }

  /** Drag from one point to another. */
  async drag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): Promise<void> {
    bridge.drag(fromX, fromY, toX, toY);
  }

  /** Press a key with optional modifiers. */
  async keyTap(
    key: string,
    modifiers: {
      shift?: boolean;
      control?: boolean;
      alt?: boolean;
      meta?: boolean;
    } = {}
  ): Promise<void> {
    bridge.keyTap(key, modifiers);
  }

  /** Type a string of text with human-like delays. */
  async typeText(text: string): Promise<void> {
    bridge.typeText(text);
  }

  /** Check if accessibility permissions are granted. */
  isAccessibilityTrusted(): boolean {
    return bridge.isAccessibilityTrusted();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cropBufferRegion(
  src: Buffer,
  srcWidth: number,
  srcHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  srcBytesPerRow?: number
): { width: number; height: number; data: Buffer } {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(srcWidth, startX + Math.max(1, Math.floor(width)));
  const endY = Math.min(srcHeight, startY + Math.max(1, Math.floor(height)));

  const outWidth = Math.max(1, endX - startX);
  const outHeight = Math.max(1, endY - startY);

  const bytesPerPixel = 4;
  const inStride = srcBytesPerRow ?? srcWidth * bytesPerPixel;
  const outStride = outWidth * bytesPerPixel;
  const out = Buffer.alloc(outStride * outHeight);

  for (let row = 0; row < outHeight; row++) {
    const inOffset = (startY + row) * inStride + startX * bytesPerPixel;
    const outOffset = row * outStride;
    src.copy(out, outOffset, inOffset, inOffset + outStride);
  }

  return { width: outWidth, height: outHeight, data: out };
}

export interface ScreenCapture {
  width: number;
  height: number;
  data: Buffer;
  timestampMs: number;
  captureMethod?: string;
  bytesPerRow?: number;
  pixelFormat?: string;
}

export interface WindowInfo {
  id: number;
  title: string;
  owner: string;
  bounds: { x: number; y: number; width: number; height: number };
  isOnScreen: boolean;
}

export interface DetectedElement {
  id: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  text?: string;
  confidence: number;
  detectionMethod?: string;
}
