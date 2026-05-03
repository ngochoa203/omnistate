import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Polyfill localStorage for Node.js environments (Node 22+ has a stub localStorage
// that requires --localstorage-file; replace it with a working in-memory mock).
// We intentionally avoid reading globalThis.localStorage directly here to prevent
// Node.js from emitting the --localstorage-file warning on its built-in webstorage getter.
(function installLocalStorageMock() {
  const descriptor =
    Object.getOwnPropertyDescriptor(globalThis, "localStorage") ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis) ?? {}, "localStorage");
  // Only install mock when localStorage is absent or is a getter (Node stub) rather than a real Storage object.
  const isRealStorage =
    descriptor?.value != null && typeof descriptor.value.clear === "function";
  if (isRealStorage) return;

  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = String(value); },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (index: number) => Object.keys(store)[index] ?? null,
    },
  });
})();

afterEach(() => {
  cleanup();
});
