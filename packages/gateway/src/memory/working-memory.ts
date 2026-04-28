import { logger } from "../utils/logger.js";

export interface WorkingMemoryEntry {
  key: string;
  value: unknown;
  scope: "task" | "session";
  createdAt: number;
  ttlMs: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SCOPE: WorkingMemoryEntry["scope"] = "task";

export class WorkingMemory {
  private entries: Map<string, WorkingMemoryEntry> = new Map();

  set(
    key: string,
    value: unknown,
    opts?: { scope?: WorkingMemoryEntry["scope"]; ttlMs?: number },
  ): void {
    this.entries.set(key, {
      key,
      value,
      scope: opts?.scope ?? DEFAULT_SCOPE,
      createdAt: Date.now(),
      ttlMs: opts?.ttlMs ?? DEFAULT_TTL_MS,
    });
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.createdAt + entry.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  getAll(scope?: WorkingMemoryEntry["scope"]): Record<string, unknown> {
    this.prune();
    const result: Record<string, unknown> = {};
    for (const entry of this.entries.values()) {
      if (scope === undefined || entry.scope === scope) {
        result[entry.key] = entry.value;
      }
    }
    return result;
  }

  clearScope(scope: WorkingMemoryEntry["scope"]): void {
    for (const [key, entry] of this.entries) {
      if (entry.scope === scope) {
        this.entries.delete(key);
      }
    }
    logger.debug({ scope }, "[working-memory] cleared scope");
  }

  toContextSnippet(maxTokens = 2000): string {
    this.prune();
    const all = this.getAll();
    if (Object.keys(all).length === 0) return "{}";
    const raw = JSON.stringify(all);
    // Approximate 1 token ≈ 4 chars
    const maxChars = maxTokens * 4;
    if (raw.length <= maxChars) return raw;
    return raw.slice(0, maxChars) + "...}";
  }

  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.createdAt + entry.ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}
