/**
 * Deep Layer — OS-level operations via Rust N-API bindings.
 *
 * Fast, programmatic, invisible to the user.
 * Handles: file I/O, process management, shell commands, network config.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export class DeepLayer {
  /** Execute a shell command and return stdout. */
  exec(command: string, timeoutMs: number = 30000): string {
    return execSync(command, {
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /** Read a file. */
  readFile(path: string): string {
    return readFileSync(path, "utf-8");
  }

  /** Write a file. */
  writeFile(path: string, content: string): void {
    writeFileSync(path, content);
  }

  /** Check if a file exists. */
  fileExists(path: string): boolean {
    return existsSync(path);
  }

  /** Check if a process is running by name. */
  isProcessRunning(name: string): boolean {
    try {
      const result = this.exec(`pgrep -x "${name}"`);
      return result.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Get current platform. */
  get platform(): "macos" | "windows" | "linux" {
    switch (process.platform) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      default:
        return "linux";
    }
  }
}
