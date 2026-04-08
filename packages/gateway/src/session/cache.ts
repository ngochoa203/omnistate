import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * UI Map cache — stores learned UI element positions per application.
 *
 * Avoids repeated LLM inference for known app interactions.
 */

export interface CachedUIMap {
  appName: string;
  appVersion?: string;
  platform: string;
  lastUpdated: string;
  elements: Record<string, CachedElement>;
  validUntil?: string;
}

export interface CachedElement {
  type: string;
  location: string;
  accessPath: string;
  confidence: number;
  lastVerified: string;
}

export class UIMapCache {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  }

  /** Get cached UI map for an application. */
  get(appName: string): CachedUIMap | null {
    const filePath = this.pathFor(appName);
    if (!existsSync(filePath)) return null;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const map: CachedUIMap = JSON.parse(raw);

      // Check expiry
      if (map.validUntil && new Date(map.validUntil) < new Date()) {
        return null;
      }

      return map;
    } catch {
      return null;
    }
  }

  /** Store a UI map for an application. */
  set(map: CachedUIMap): void {
    const filePath = this.pathFor(map.appName);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(map, null, 2));
  }

  /** Invalidate cache for an application. */
  invalidate(appName: string): void {
    const filePath = this.pathFor(appName);
    if (existsSync(filePath)) {
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      unlinkSync(filePath);
    }
  }

  private pathFor(appName: string): string {
    const safe = appName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return `${this.cacheDir}/${safe}.json`;
  }
}
