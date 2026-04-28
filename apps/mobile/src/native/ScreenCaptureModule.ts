/**
 * ScreenCaptureModule — bridge to OmniScreenCapture Kotlin module.
 * MediaProjection-based screen capture with 3-layer fallback (real/guard/mock).
 */

import { NativeModules } from "react-native";

declare const console: { warn: (...args: unknown[]) => void };

export interface ScreenCaptureModuleInterface {
  requestPermission(): Promise<boolean>;
  captureScreenshot(quality?: number): Promise<string>;
  stopCapture(): Promise<void>;
  isCapturing(): Promise<boolean>;
}

type NativeScreenCapture = {
  requestPermission(): Promise<boolean>;
  captureScreenshot(quality: number): Promise<string>;
  stopCapture(): Promise<void>;
  isCapturing(): Promise<boolean>;
};

function warn(msg: string): void {
  console.warn(`[ScreenCaptureModule] ${msg}`);
}

function buildReal(n: NativeScreenCapture): ScreenCaptureModuleInterface {
  return {
    requestPermission: () => n.requestPermission(),
    captureScreenshot: (q = 85) => n.captureScreenshot(q),
    stopCapture: () => n.stopCapture(),
    isCapturing: () => n.isCapturing(),
  };
}

function buildMock(): ScreenCaptureModuleInterface {
  return {
    async requestPermission() {
      warn("requestPermission (mock) → true");
      return true;
    },
    async captureScreenshot(quality = 85) {
      warn(`captureScreenshot (mock) quality=${quality} → ""`);
      return "";
    },
    async stopCapture() {
      warn("stopCapture (mock)");
    },
    async isCapturing() {
      return false;
    },
  };
}

function create(): ScreenCaptureModuleInterface {
  const native = NativeModules.OmniScreenCapture as NativeScreenCapture | undefined;
  if (native) return buildReal(native);
  warn("NativeModules.OmniScreenCapture not found — using mock.");
  return buildMock();
}

export const ScreenCaptureModule: ScreenCaptureModuleInterface = create();
