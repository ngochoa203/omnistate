import { EventBus } from "./event-bus.js";
import { v4 as uuid } from "uuid";
import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { logger } from "../utils/logger.js";

function getRunningApps(): Set<string> {
  try {
    // Try platform bridge first — fall back to ps
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bridge = require("../platform/bridge.js") as Record<string, unknown>;
    if (typeof (bridge as any).getRunningApps === "function") {
      const apps = (bridge as any).getRunningApps() as string[];
      return new Set(apps);
    }
  } catch {
    // bridge not available
  }
  const output = execSync("ps -eo comm=", { encoding: "utf-8" });
  return new Set(output.split("\n").filter(Boolean).map((s) => s.trim()));
}

export class OSFirehose {
  private bus: EventBus;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private clipboardInterval: ReturnType<typeof setInterval> | null = null;
  private systemInterval: ReturnType<typeof setInterval> | null = null;
  private fsWatchers: FSWatcher[] = [];
  private lastProcessList: Set<string> = new Set();
  private lastClipboard: string = "";

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  start(): void {
    // Initial process snapshot
    try {
      this.lastProcessList = getRunningApps();
    } catch (err) {
      logger.warn({ err }, "[firehose] Failed to get initial process list");
    }

    // Process monitor — every 5s
    this.processInterval = setInterval(() => {
      try {
        const current = getRunningApps();
        for (const app of current) {
          if (!this.lastProcessList.has(app)) {
            this.bus.emit({
              id: uuid(),
              type: "app.opened",
              source: "os-firehose",
              payload: { app },
              timestamp: Date.now(),
            });
          }
        }
        for (const app of this.lastProcessList) {
          if (!current.has(app)) {
            this.bus.emit({
              id: uuid(),
              type: "app.closed",
              source: "os-firehose",
              payload: { app },
              timestamp: Date.now(),
            });
          }
        }
        this.lastProcessList = current;
      } catch (err) {
        logger.warn({ err }, "[firehose] Process monitor error");
      }
    }, 5_000);

    // FS watchers for ~/Downloads and ~/Desktop
    const watchDirs = [join(homedir(), "Downloads"), join(homedir(), "Desktop")];
    for (const dir of watchDirs) {
      try {
        const watcher = watch(dir, (eventType, filename) => {
          const type = eventType === "rename" ? "file.created" : "file.modified";
          this.bus.emit({
            id: uuid(),
            type,
            source: "os-firehose",
            payload: { dir, filename: filename ?? "" },
            timestamp: Date.now(),
          });
        });
        watcher.on("error", (err) => {
          logger.warn({ err }, `[firehose] FS watcher error for ${dir}`);
        });
        this.fsWatchers.push(watcher);
      } catch (err) {
        logger.warn({ err }, `[firehose] Failed to watch ${dir}`);
      }
    }

    // Clipboard monitor — every 2s (macOS only)
    try {
      this.lastClipboard = execSync("pbpaste", { encoding: "utf-8" });
    } catch {
      // pbpaste not available (non-macOS)
    }

    this.clipboardInterval = setInterval(() => {
      try {
        const current = execSync("pbpaste", { encoding: "utf-8" });
        if (current !== this.lastClipboard) {
          this.lastClipboard = current;
          this.bus.emit({
            id: uuid(),
            type: "clipboard.changed",
            source: "os-firehose",
            payload: { preview: current.slice(0, 100) },
            timestamp: Date.now(),
          });
        }
      } catch {
        // pbpaste unavailable — skip
      }
    }, 2_000);

    // System monitor — every 30s
    this.systemInterval = setInterval(() => {
      try {
        const battOut = execSync("pmset -g batt", { encoding: "utf-8" });
        const pctMatch = battOut.match(/(\d+)%/);
        if (pctMatch) {
          const pct = parseInt(pctMatch[1], 10);
          if (pct < 20) {
            this.bus.emit({
              id: uuid(),
              type: "battery.low",
              source: "os-firehose",
              payload: { percent: pct },
              timestamp: Date.now(),
            });
          }
        }
      } catch {
        // pmset unavailable — skip
      }
    }, 30_000);

    logger.info("[firehose] Started");
  }

  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    if (this.clipboardInterval) {
      clearInterval(this.clipboardInterval);
      this.clipboardInterval = null;
    }
    if (this.systemInterval) {
      clearInterval(this.systemInterval);
      this.systemInterval = null;
    }
    for (const watcher of this.fsWatchers) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    this.fsWatchers = [];
    logger.info("[firehose] Stopped");
  }
}
