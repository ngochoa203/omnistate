type NativeStorageBridge = {
  isNative?: boolean;
  storageGet?: (key: string) => string | null | undefined;
  storageSet?: (key: string, value: string) => void;
  storageRemove?: (key: string) => void;
};

declare global {
  interface Window {
    omnistateNative?: NativeStorageBridge;
  }
}

function getNativeBridge(): NativeStorageBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.omnistateNative;
  if (!bridge?.isNative) return null;
  return bridge;
}

export function storageGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  const bridge = getNativeBridge();
  if (bridge?.storageGet) {
    const value = bridge.storageGet(key);
    return typeof value === "string" ? value : null;
  }

  return window.localStorage.getItem(key);
}

export function storageSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  const bridge = getNativeBridge();
  if (bridge?.storageSet) {
    bridge.storageSet(key, value);
    return;
  }

  window.localStorage.setItem(key, value);
}

export function storageRemoveItem(key: string): void {
  if (typeof window === "undefined") return;
  const bridge = getNativeBridge();
  if (bridge?.storageRemove) {
    bridge.storageRemove(key);
    return;
  }

  window.localStorage.removeItem(key);
}
