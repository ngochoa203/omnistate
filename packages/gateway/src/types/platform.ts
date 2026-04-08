/**
 * Platform abstraction interfaces.
 *
 * These are the TypeScript-side contracts for what the Rust N-API
 * bindings expose. The actual implementations live in omnistate-napi.
 */

export interface ScreenFrame {
  width: number;
  height: number;
  bytesPerPixel: number;
  timestampNs: string;
  captureMethod: "GpuFramebuffer" | "Screenshot" | "WindowCapture";
  dataLength: number;
}

export interface PlatformScreen {
  captureScreen(): ScreenFrame;
  captureWindow(windowId: number): ScreenFrame;
  captureScreenBuffer(): Buffer;
}

export interface PlatformInput {
  moveMouse(x: number, y: number): void;
  click(button: "left" | "right" | "middle"): void;
  doubleClick(button: "left" | "right" | "middle"): void;
  scroll(dx: number, dy: number): void;
  keyTap(
    key: string,
    shift: boolean,
    control: boolean,
    alt: boolean,
    meta: boolean
  ): void;
  typeText(text: string): void;
}

export interface UIElementInfo {
  id: string;
  elementType: string;
  bounds: { x: number; y: number; width: number; height: number };
  text?: string;
  state: {
    visible: boolean;
    enabled: boolean;
    focused: boolean;
    selected: boolean;
  };
  confidence: number;
  detectionMethod: string;
  semanticRole?: string;
}

export interface PlatformAccessibility {
  getUIElements(): UIElementInfo[];
  findElement(query: string): UIElementInfo | null;
}
