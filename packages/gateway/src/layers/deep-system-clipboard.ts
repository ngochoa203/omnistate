/**
 * Deep System Layer — Clipboard Management (UC-B18).
 *
 * macOS-first; Linux fallbacks where reasonable.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { DeepLayer } from "./deep.js";
import type { ClipboardEntry, ClipboardHistoryEntry } from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

abstract class DeepSystemClipboardCore {
  constructor(protected readonly deep: DeepLayer) {}

  protected get os(): "macos" | "windows" | "linux" {
    switch (platform()) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      default:
        return "linux";
    }
  }

  protected async run(cmd: string, timeoutMs = 30_000): Promise<string> {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

export class DeepSystemClipboardLayer extends DeepSystemClipboardCore {
  /** In-memory clipboard history for UC-B18. */
  private clipboardHistory: ClipboardEntry[] = [];

  /** Path to persistent clipboard history JSON file. */
  private readonly clipboardHistoryPath = join(
    homedir(),
    ".omnistate",
    "clipboard-history.json"
  );

  /** Max entries kept in persistent clipboard history. */
  private static readonly CLIPBOARD_HISTORY_MAX = 500;

  /** Max bytes stored per clipboard history entry (10 KB). */
  private static readonly CLIPBOARD_ENTRY_MAX_BYTES = 10 * 1024;

  /**
   * Get current clipboard text content.
   * macOS: `pbpaste`; Linux: `xclip -o` / `xsel -o`.
   */
  async getClipboard(): Promise<string> {
    try {
      if (this.os === "macos") return await this.run("pbpaste");
      return (
        (await this.run("xclip -selection clipboard -o 2>/dev/null")) ||
        (await this.run("xsel --clipboard --output 2>/dev/null"))
      );
    } catch {
      return "";
    }
  }

  /**
   * Set clipboard text content.
   * macOS: `pbcopy`; Linux: `xclip` / `xsel`.
   * Also appends to in-memory history.
   */
  async setClipboard(content: string): Promise<boolean> {
    try {
      if (this.os === "macos") {
        const { exec: cp } = await import("node:child_process");
        await new Promise<void>((resolve, reject) => {
          const proc = cp("pbcopy", (err) => (err ? reject(err) : resolve()));
          proc.stdin?.end(content);
        });
      } else {
        const { exec: cp } = await import("node:child_process");
        const tool = (await this.run("which xclip 2>/dev/null"))
          ? "xclip -selection clipboard"
          : "xsel --clipboard --input";
        await new Promise<void>((resolve, reject) => {
          const proc = cp(tool, (err) => (err ? reject(err) : resolve()));
          proc.stdin?.end(content);
        });
      }
      this.clipboardHistory.push({
        content,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return the in-memory clipboard history (most recent last).
   */
  getClipboardHistory(): ClipboardEntry[] {
    return [...this.clipboardHistory];
  }

  /**
   * Clear the system clipboard and in-memory history.
   */
  async clearClipboard(): Promise<boolean> {
    try {
      await this.setClipboard("");
      this.clipboardHistory = [];
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List the data types currently on the macOS pasteboard.
   * Returns an array of UTI strings (e.g. "public.utf8-plain-text").
   */
  async getClipboardFormats(): Promise<string[]> {
    try {
      if (this.os !== "macos") return ["text/plain"];
      const out = await this.run(
        `osascript -e 'clipboard info' 2>/dev/null`
      );
      return out.split(",").map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Save the current clipboard image to a file (macOS only).
   * Tries `pngpaste` first, then falls back to an inline osascript/Swift snippet.
   * Returns null when the clipboard contains no image data.
   */
  async getClipboardImage(
    outputPath: string
  ): Promise<{ saved: boolean; path: string; format: string; size: number } | null> {
    if (this.os !== "macos") return null;
    try {
      // Check whether clipboard has image data
      const formats = await this.getClipboardFormats();
      const hasImage = formats.some(
        (f) =>
          f.includes("TIFF") ||
          f.includes("PNG") ||
          f.includes("JPEG") ||
          f.includes("GIF") ||
          f.includes("BMP")
      );
      if (!hasImage) return null;

      // Try pngpaste (brew install pngpaste)
      const hasPngpaste = await this.run("which pngpaste 2>/dev/null");
      if (hasPngpaste) {
        const result = await this.run(`pngpaste "${outputPath}" 2>/dev/null`);
        if (existsSync(outputPath)) {
          const { size } = statSync(outputPath);
          return { saved: true, path: outputPath, format: "png", size };
        }
        void result;
      }

      // Fallback: osascript write PNG data
      const script = [
        `set imgData to the clipboard as «class PNGf»`,
        `set f to open for access POSIX file "${outputPath}" with write permission`,
        `write imgData to f`,
        `close access f`,
      ].join("\n");
      await this.run(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      if (existsSync(outputPath)) {
        const { size } = statSync(outputPath);
        return { saved: true, path: outputPath, format: "png", size };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Copy a file reference to the macOS clipboard (sets it as a file-URL pasteboard item).
   * macOS only — uses `osascript`.
   */
  async copyFileToClipboard(filePath: string): Promise<boolean> {
    if (this.os !== "macos") return false;
    try {
      const escaped = filePath.replace(/"/g, '\\"');
      await this.run(
        `osascript -e 'set the clipboard to POSIX file "${escaped}"'`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get clipboard content as RTF (macOS only).
   * Returns null when no RTF data is on the pasteboard.
   */
  async getClipboardRTF(): Promise<string | null> {
    if (this.os !== "macos") return null;
    try {
      const out = await this.run(
        `osascript -e 'the clipboard as «class RTF »' 2>/dev/null`
      );
      if (!out) return null;
      // osascript returns hex-encoded data «data RTF …» — decode it
      const hex = out.replace(/^«data RTF\s+/, "").replace(/»$/, "");
      if (hex) {
        return Buffer.from(hex, "hex").toString("utf-8");
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Set clipboard to RTF content (macOS only).
   * Writes RTF to a temp file then loads it via osascript.
   */
  async setClipboardRTF(rtfContent: string): Promise<boolean> {
    if (this.os !== "macos") return false;
    try {
      const { tmpdir } = await import("node:os");
      const tmpFile = join(tmpdir(), `omnistate-rtf-${Date.now()}.rtf`);
      writeFileSync(tmpFile, rtfContent, "utf-8");
      const escaped = tmpFile.replace(/"/g, '\\"');
      const script = [
        `set f to open for access POSIX file "${escaped}"`,
        `set rtfData to read f as «class RTF »`,
        `close access f`,
        `set the clipboard to rtfData`,
      ].join("\n");
      await this.run(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore cleanup error
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Persistent Clipboard History ─────────────────────────────────────────

  /**
   * Read the persistent clipboard history from disk.
   */
  private readPersistentHistory(): ClipboardHistoryEntry[] {
    try {
      if (!existsSync(this.clipboardHistoryPath)) return [];
      const raw = readFileSync(this.clipboardHistoryPath, "utf-8");
      return JSON.parse(raw) as ClipboardHistoryEntry[];
    } catch {
      return [];
    }
  }

  /**
   * Write the persistent clipboard history to disk (auto-prunes to max 500).
   */
  private writePersistentHistory(entries: ClipboardHistoryEntry[]): void {
    try {
      const dir = join(homedir(), ".omnistate");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const pruned = entries.slice(
        -DeepSystemClipboardLayer.CLIPBOARD_HISTORY_MAX
      );
      writeFileSync(this.clipboardHistoryPath, JSON.stringify(pruned, null, 2), "utf-8");
    } catch {
      // ignore write failures
    }
  }

  /**
   * Snapshot the current clipboard and append it to the persistent history.
   * Detects text, RTF, image, and file types automatically.
   */
  async saveClipboardEntry(): Promise<void> {
    try {
      const formats = await this.getClipboardFormats();
      const hasRTF = formats.some((f) => f.includes("RTF"));
      const hasImage = formats.some(
        (f) => f.includes("TIFF") || f.includes("PNG") || f.includes("JPEG") || f.includes("GIF")
      );
      const hasFile = formats.some((f) => f.includes("furl") || f.includes("file"));

      let type: ClipboardHistoryEntry["type"] = "text";
      let text = "";

      if (hasFile) {
        type = "file";
        text = await this.getClipboard();
      } else if (hasImage) {
        type = "image";
        text = "[image]";
      } else if (hasRTF) {
        type = "rtf";
        const rtf = await this.getClipboardRTF();
        text = rtf ?? "";
      } else {
        type = "text";
        text = await this.getClipboard();
      }

      if (!text && type !== "image") return;

      // Truncate to 10 KB
      const truncated = text.slice(0, DeepSystemClipboardLayer.CLIPBOARD_ENTRY_MAX_BYTES);

      const existing = this.readPersistentHistory();

      // Avoid duplicate consecutive entries
      const last = existing[existing.length - 1];
      if (last && last.text === truncated && last.type === type) return;

      existing.push({ text: truncated, timestamp: Date.now(), type });
      this.writePersistentHistory(existing);
    } catch {
      // ignore
    }
  }

  /**
   * Return persistent clipboard history entries (most recent last).
   * @param limit Maximum number of entries to return (default: all).
   */
  async getPersistentClipboardHistory(
    limit?: number
  ): Promise<ClipboardHistoryEntry[]> {
    const entries = this.readPersistentHistory();
    if (limit !== undefined && limit > 0) {
      return entries.slice(-limit);
    }
    return entries;
  }

  /**
   * Clear the persistent clipboard history file and in-memory history.
   */
  async clearClipboardHistory(): Promise<void> {
    try {
      this.clipboardHistory = [];
      if (existsSync(this.clipboardHistoryPath)) {
        writeFileSync(this.clipboardHistoryPath, "[]", "utf-8");
      }
    } catch {
      // ignore
    }
  }

  /**
   * Poll the clipboard at `intervalMs` (default 1 s), save a history entry on change.
   * Returns an object with a `stop()` function to cancel the watcher.
   */
  async startClipboardWatch(
    intervalMs = 1000
  ): Promise<{ stop: () => void }> {
    let lastText = await this.getClipboard();
    let active = true;

    const tick = async () => {
      if (!active) return;
      try {
        const current = await this.getClipboard();
        if (current !== lastText) {
          lastText = current;
          await this.saveClipboardEntry();
        }
      } catch {
        // ignore tick errors
      }
      if (active) {
        setTimeout(tick, intervalMs);
      }
    };

    setTimeout(tick, intervalMs);

    return {
      stop: () => {
        active = false;
      },
    };
  }
}