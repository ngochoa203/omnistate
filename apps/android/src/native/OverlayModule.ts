/**
 * OverlayModule — bridge to OmniOverlay Kotlin module.
 * Floating overlay window with 3-layer fallback (real/guard/mock).
 */

import { NativeModules } from "react-native";

declare const console: { warn: (...args: unknown[]) => void };

export interface OverlayModuleInterface {
  showOverlay(): Promise<void>;
  hideOverlay(): Promise<void>;
  updateStatus(text: string): Promise<void>;
  setExpanded(expanded: boolean): Promise<void>;
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
}

type NativeOverlay = {
  showOverlay(): Promise<void>;
  hideOverlay(): Promise<void>;
  updateStatus(text: string): Promise<void>;
  setExpanded(expanded: boolean): Promise<void>;
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
};

function warn(msg: string): void {
  console.warn(`[OverlayModule] ${msg}`);
}

function buildReal(n: NativeOverlay): OverlayModuleInterface {
  return {
    showOverlay: () => n.showOverlay(),
    hideOverlay: () => n.hideOverlay(),
    updateStatus: (t) => n.updateStatus(t),
    setExpanded: (e) => n.setExpanded(e),
    hasOverlayPermission: () => n.hasOverlayPermission(),
    requestOverlayPermission: () => n.requestOverlayPermission(),
  };
}

function buildMock(): OverlayModuleInterface {
  return {
    async showOverlay() { warn("showOverlay (mock)"); },
    async hideOverlay() { warn("hideOverlay (mock)"); },
    async updateStatus(t) { warn(`updateStatus (mock) "${t}"`); },
    async setExpanded(e) { warn(`setExpanded (mock) ${e}`); },
    async hasOverlayPermission() { return true; },
    async requestOverlayPermission() { warn("requestOverlayPermission (mock)"); },
  };
}

function create(): OverlayModuleInterface {
  const native = NativeModules.OmniOverlay as NativeOverlay | undefined;
  if (native) return buildReal(native);
  warn("NativeModules.OmniOverlay not found — using mock.");
  return buildMock();
}

export const OverlayModule: OverlayModuleInterface = create();
