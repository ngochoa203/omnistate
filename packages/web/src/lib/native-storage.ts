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

/** Guard: returns the real localStorage only if it is fully functional.
 *
 * Node.js 22+ exposes a built-in `localStorage` stub via the WebStorage API
 * that requires `--localstorage-file` to work and emits a process warning on
 * first access. We suppress this by checking for the function *before* touching
 * the getter, and catching any exception that the getter might throw.
 */
function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // Access the descriptor to avoid triggering Node.js's getter-based warning.
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")
      ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), "localStorage");
    if (!descriptor) return null;
    // If it's a data property, use it directly; if an accessor, call it safely.
    const ls = descriptor.value ?? (descriptor.get ? descriptor.get.call(window) : null);
    if (typeof ls?.getItem !== "function") return null;
    return ls as Storage;
  } catch {
    return null;
  }
}

export function storageGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  const bridge = getNativeBridge();
  if (bridge?.storageGet) {
    const value = bridge.storageGet(key);
    return typeof value === "string" ? value : null;
  }

  return getLocalStorage()?.getItem(key) ?? null;
}

export function storageSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  const bridge = getNativeBridge();
  if (bridge?.storageSet) {
    bridge.storageSet(key, value);
    return;
  }

  getLocalStorage()?.setItem(key, value);
}

export function storageRemoveItem(key: string): void {
  if (typeof window === "undefined") return;
  const bridge = getNativeBridge();
  if (bridge?.storageRemove) {
    bridge.storageRemove(key);
    return;
  }

  getLocalStorage()?.removeItem(key);
}
