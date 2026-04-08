/**
 * Surface Layer — vision-based UI interaction.
 *
 * Captures the screen, detects UI elements via vision model,
 * and operates mouse/keyboard like a human.
 *
 * TODO: Integrate with omnistate-napi Rust bindings for:
 * - Screen capture (captureScreen, captureScreenBuffer)
 * - Mouse control (moveMouse, click, doubleClick, scroll)
 * - Keyboard control (keyTap, typeText)
 * - Accessibility (getUIElements, findElement)
 */

export class SurfaceLayer {
  /** Capture the current screen. */
  async captureScreen(): Promise<ScreenCapture> {
    // TODO: Call Rust N-API binding
    throw new Error("Screen capture not yet connected — Rust N-API binding needed");
  }

  /** Find a UI element by description. */
  async findElement(description: string): Promise<DetectedElement | null> {
    // TODO: Combine accessibility API + vision model
    throw new Error(`Element detection not yet implemented: ${description}`);
  }

  /** Click on a detected element. */
  async clickElement(_element: DetectedElement): Promise<void> {
    // TODO: Move mouse to element center, then click
    throw new Error("Click not yet connected — Rust N-API binding needed");
  }

  /** Type text into the focused element. */
  async typeText(text: string): Promise<void> {
    // TODO: Call Rust N-API typeText binding
    throw new Error(`Type not yet connected: ${text}`);
  }
}

export interface ScreenCapture {
  width: number;
  height: number;
  data: Buffer;
  timestampMs: number;
}

export interface DetectedElement {
  id: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  text?: string;
  confidence: number;
}
