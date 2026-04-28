/**
 * AccessibilityModule — bridge to OmniAccessibility Kotlin module.
 *
 * Runtime strategy (in priority order):
 *   1. NativeModules.OmniAccessibility  (requires the Kotlin module to be built)
 *   2. Permission-guard layer           (checks service-enabled before every call)
 *   3. Dev-mock                         (logs warnings, returns fake data)
 *
 * Required AndroidManifest.xml:
 *   <uses-permission android:name="android.permission.BIND_ACCESSIBILITY_SERVICE" />
 *
 * The user must also enable OmniState in Android Settings → Accessibility.
 */

import { NativeModules, Linking } from "react-native";

declare const console: { warn: (...args: unknown[]) => void };

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScreenNode {
  /** Visible text content of the node. */
  text: string;
  /** Android View class name, e.g. "android.widget.TextView". */
  className: string;
  /** Absolute screen bounds. */
  bounds: ElementBounds;
  /** Whether the node responds to tap actions. */
  clickable: boolean;
  /** Content description / accessibility label. */
  contentDescription?: string;
  /** Child nodes. */
  children?: ScreenNode[];
}

export interface ElementBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Computed center X. */
  centerX: number;
  /** Computed center Y. */
  centerY: number;
  width: number;
  height: number;
}

export type SystemAction = "back" | "home" | "recents" | "notifications" | "power";

export interface AccessibilityModuleInterface {
  /** Returns the full UI accessibility tree of the current screen. */
  getScreenTree(): Promise<ScreenNode[]>;
  /** Performs a tap at the given screen coordinates. */
  tap(x: number, y: number): Promise<void>;
  /** Performs a swipe gesture. Duration defaults to 300ms. */
  swipe(fromX: number, fromY: number, toX: number, toY: number, duration?: number): Promise<void>;
  /** Types text into the currently focused input. */
  typeText(text: string): Promise<void>;
  /** Triggers a global system action. */
  performAction(action: SystemAction): Promise<void>;
  /** Finds the first element whose text matches and returns its bounds, or null. */
  findElementByText(text: string): Promise<ElementBounds | null>;
  /** Returns true when the OmniAccessibility service is enabled. */
  isServiceEnabled(): Promise<boolean>;
  /** Opens Android Accessibility Settings so the user can enable the service. */
  openAccessibilitySettings(): void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function warn(msg: string): void {
  console.warn(`[AccessibilityModule] ${msg}`);
}

function makeBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
): ElementBounds {
  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
    width: right - left,
    height: bottom - top,
  };
}

// ── Real implementation ────────────────────────────────────────────────────────

type NativeAccessibility = {
  getScreenTree(): Promise<ScreenNode[]>;
  tap(x: number, y: number): Promise<void>;
  swipe(fromX: number, fromY: number, toX: number, toY: number, duration: number): Promise<void>;
  typeText(text: string): Promise<void>;
  performAction(action: SystemAction): Promise<void>;
  findElementByText(text: string): Promise<ElementBounds | null>;
  isServiceEnabled(): Promise<boolean>;
};

function buildRealModule(native: NativeAccessibility): AccessibilityModuleInterface {
  return {
    getScreenTree: () => native.getScreenTree(),
    tap: (x, y) => native.tap(x, y),
    swipe: (fromX, fromY, toX, toY, duration = 300) =>
      native.swipe(fromX, fromY, toX, toY, duration),
    typeText: (text) => native.typeText(text),
    performAction: (action) => native.performAction(action),
    findElementByText: (text) => native.findElementByText(text),
    isServiceEnabled: () => native.isServiceEnabled(),
    openAccessibilitySettings: () => {
      Linking.openSettings();
    },
  };
}

// ── Guard layer ────────────────────────────────────────────────────────────────
//
// Wraps the real module to check service-enabled before every call that
// requires the accessibility service to be active.

function buildGuardModule(inner: AccessibilityModuleInterface): AccessibilityModuleInterface {
  async function requireService(): Promise<void> {
    const enabled = await inner.isServiceEnabled();
    if (!enabled) {
      throw new Error(
        "OmniAccessibility service is not enabled. " +
          "Call openAccessibilitySettings() to let the user enable it.",
      );
    }
  }

  return {
    async getScreenTree() {
      await requireService();
      return inner.getScreenTree();
    },
    async tap(x, y) {
      await requireService();
      return inner.tap(x, y);
    },
    async swipe(fromX, fromY, toX, toY, duration) {
      await requireService();
      return inner.swipe(fromX, fromY, toX, toY, duration);
    },
    async typeText(text) {
      await requireService();
      return inner.typeText(text);
    },
    async performAction(action) {
      await requireService();
      return inner.performAction(action);
    },
    async findElementByText(text) {
      await requireService();
      return inner.findElementByText(text);
    },
    isServiceEnabled: () => inner.isServiceEnabled(),
    openAccessibilitySettings: () => inner.openAccessibilitySettings(),
  };
}

// ── Dev-mock implementation ────────────────────────────────────────────────────

function buildMockModule(): AccessibilityModuleInterface {
  const ENABLE_HINT =
    "Build the OmniAccessibility Kotlin module and enable it in Android Settings → Accessibility.";

  return {
    async getScreenTree() {
      warn(`getScreenTree (mock) — ${ENABLE_HINT}`);
      const fakeBounds = makeBounds(0, 0, 1080, 1920);
      const mockNode: ScreenNode = {
        text: "Mock Screen",
        className: "android.widget.FrameLayout",
        bounds: fakeBounds,
        clickable: false,
        children: [
          {
            text: "OK",
            className: "android.widget.Button",
            bounds: makeBounds(400, 800, 680, 880),
            clickable: true,
          },
        ],
      };
      return [mockNode];
    },

    async tap(x, y) {
      warn(`tap (mock) → x=${x} y=${y}`);
    },

    async swipe(fromX, fromY, toX, toY, duration = 300) {
      warn(`swipe (mock) → (${fromX},${fromY}) → (${toX},${toY}) ${duration}ms`);
    },

    async typeText(text) {
      warn(`typeText (mock) → "${text}"`);
    },

    async performAction(action) {
      warn(`performAction (mock) → "${action}"`);
    },

    async findElementByText(text) {
      warn(`findElementByText (mock) → "${text}" → null`);
      return null;
    },

    async isServiceEnabled() {
      warn("isServiceEnabled (mock) → true");
      return true;
    },

    openAccessibilitySettings() {
      warn("openAccessibilitySettings (mock) — would open Android settings");
    },
  };
}

// ── Module factory ─────────────────────────────────────────────────────────────

function createAccessibilityModule(): AccessibilityModuleInterface {
  const native = NativeModules.OmniAccessibility as NativeAccessibility | undefined;

  if (native) {
    const real = buildRealModule(native);
    return buildGuardModule(real);
  }

  warn(
    "NativeModules.OmniAccessibility not found — using dev-mock. " +
      "Build the Kotlin module and rebuild the app.",
  );
  return buildMockModule();
}

// ── Singleton export ───────────────────────────────────────────────────────────

export const AccessibilityModule: AccessibilityModuleInterface = createAccessibilityModule();
