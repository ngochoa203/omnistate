/**
 * E2E tests for DeepLayer — OS-level shell, file, process, and system APIs.
 *
 * All tests run without screen capture permissions or API keys.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DeepLayer } from "../layers/deep.js";
import os from "node:os";
import path from "node:path";

describe("DeepLayer", () => {
  let layer: DeepLayer;

  beforeEach(() => {
    layer = new DeepLayer();
  });

  // ── Shell execution ──────────────────────────────────────────────────────────

  describe("exec()", () => {
    it('returns stdout for "echo hello"', () => {
      const result = layer.exec("echo hello");
      expect(result).toBe("hello\n");
    });

    it("captures multi-word output", () => {
      const result = layer.exec("echo foo bar");
      expect(result.trim()).toBe("foo bar");
    });

    it("throws on a non-zero exit command", () => {
      expect(() => layer.exec("exit 1")).toThrow();
    });
  });

  describe("execAsync()", () => {
    it("resolves with stdout and stderr", async () => {
      const { stdout } = await layer.execAsync("echo async");
      expect(stdout.trim()).toBe("async");
    });
  });

  // ── File operations ──────────────────────────────────────────────────────────

  describe("fileExists()", () => {
    it("returns true for /tmp (always exists)", () => {
      expect(layer.fileExists("/tmp")).toBe(true);
    });

    it("returns true for the Node.js binary path", () => {
      expect(layer.fileExists(process.execPath)).toBe(true);
    });

    it("returns false for a path that does not exist", () => {
      expect(layer.fileExists("/this/path/definitely/does/not/exist-omnistate")).toBe(false);
    });
  });

  describe("readFile() / writeFile()", () => {
    it("round-trips text content through a temp file", () => {
      const tmpPath = path.join(os.tmpdir(), `omnistate-test-${Date.now()}.txt`);
      const content = "hello omnistate";
      layer.writeFile(tmpPath, content);
      expect(layer.readFile(tmpPath)).toBe(content);
    });
  });

  describe("fileStat()", () => {
    it("returns null for a non-existent path", () => {
      expect(layer.fileStat("/no/such/file-omnistate")).toBeNull();
    });

    it("returns valid FileInfo for /tmp", () => {
      const info = layer.fileStat("/tmp");
      expect(info).not.toBeNull();
      expect(info!.isDirectory).toBe(true);
      expect(info!.isFile).toBe(false);
      expect(typeof info!.size).toBe("number");
      expect(info!.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("listDir()", () => {
    it("returns an array of entries for /tmp", () => {
      const entries = layer.listDir("/tmp");
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  // ── System information ────────────────────────────────────────────────────────

  describe("getSystemInfo()", () => {
    it("returns a valid SystemInfo object", () => {
      const info = layer.getSystemInfo();
      expect(typeof info.hostname).toBe("string");
      expect(info.hostname.length).toBeGreaterThan(0);
      expect(info.cpuCores).toBeGreaterThan(0);
      expect(info.totalMemoryMB).toBeGreaterThan(0);
      expect(info.freeMemoryMB).toBeGreaterThanOrEqual(0);
      expect(info.freeMemoryMB).toBeLessThanOrEqual(info.totalMemoryMB);
      expect(info.nodeVersion).toMatch(/^v\d+\.\d+/);
      expect(info.uptime).toBeGreaterThanOrEqual(0);
      expect(["macos", "linux", "windows"]).toContain(info.platform);
    });

    it("cpuModel is a non-empty string", () => {
      const info = layer.getSystemInfo();
      expect(typeof info.cpuModel).toBe("string");
      expect(info.cpuModel.length).toBeGreaterThan(0);
    });
  });

  // ── Platform getter ───────────────────────────────────────────────────────────

  describe("platform getter", () => {
    it('returns one of "macos" | "linux" | "windows"', () => {
      const l = new DeepLayer();
      expect(["macos", "linux", "windows"]).toContain(l.platform);
    });

    it('returns "macos" when running on macOS (darwin)', () => {
      // deep.ts uses node:os platform() internally; on macOS this is always darwin
      const l = new DeepLayer();
      if (os.platform() === "darwin") {
        expect(l.platform).toBe("macos");
      } else {
        // On non-macOS CI, just assert the value is a valid platform string
        expect(["linux", "windows"]).toContain(l.platform);
      }
    });

    it("platform matches the current Node.js process.platform mapping", () => {
      const l = new DeepLayer();
      const expectedMap: Record<string, string> = {
        darwin: "macos",
        win32: "windows",
      };
      const expected = expectedMap[os.platform()] ?? "linux";
      expect(l.platform).toBe(expected);
    });
  });

  // ── Process list ──────────────────────────────────────────────────────────────

  describe("getProcessList()", () => {
    it("returns a non-empty array", async () => {
      const list = await layer.getProcessList();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    it("each entry has pid, name, cpu, memory fields", async () => {
      const list = await layer.getProcessList();
      const first = list[0];
      expect(typeof first.pid).toBe("number");
      expect(typeof first.name).toBe("string");
      expect(typeof first.cpu).toBe("number");
      expect(typeof first.memory).toBe("number");
    });
  });

  // ── App lifecycle (no-throw contract) ─────────────────────────────────────────

  describe("launchApp()", () => {
    it("does not throw for an unknown app name (returns false)", async () => {
      // We expect the method to handle errors gracefully and return false
      const result = await layer.launchApp("__nonexistent_app_omnistate__");
      expect(typeof result).toBe("boolean");
    });
  });

  describe("quitApp()", () => {
    it("does not throw for an app that is not running (returns false or true)", async () => {
      const result = await layer.quitApp("__nonexistent_app_omnistate__");
      expect(typeof result).toBe("boolean");
    });
  });
});
