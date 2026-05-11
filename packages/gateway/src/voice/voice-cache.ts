import { childLogger } from "../utils/logger.js";

const log = childLogger("voice-cache");

export interface CacheKey {
  text?: string;
  normalizedText?: string;
  language?: string;
  intent?: string;
  sessionId?: string;
  userId?: string;
}

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  source?: string;
}

export interface VoiceCache {
  get<T>(key: CacheKey): T | null;
  set<T>(key: CacheKey, value: T, ttlMs?: number, source?: string): void;
  delete(key: CacheKey): boolean;
  clear(): void;
  stats(): CacheStats;
  prune(): number;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  memoryEstimateBytes: number;
  expiredEntries: number;
  oldestEntry: number;
  newestEntry: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 1000;

class VoiceCacheImpl implements VoiceCache {
  private entries = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private maxEntries: number;
  private maxTtlMs: number;

  constructor(options?: { maxEntries?: number; maxTtlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? MAX_ENTRIES;
    this.maxTtlMs = options?.maxTtlMs ?? DEFAULT_TTL_MS;
  }

  private buildKey(key: CacheKey): string {
    // Build a deterministic key from all provided fields
    const parts: string[] = [];

    if (key.text !== undefined) parts.push(`t:${key.text}`);
    if (key.normalizedText !== undefined) parts.push(`n:${key.normalizedText}`);
    if (key.language !== undefined) parts.push(`l:${key.language}`);
    if (key.intent !== undefined) parts.push(`i:${key.intent}`);
    if (key.sessionId !== undefined) parts.push(`s:${key.sessionId}`);
    if (key.userId !== undefined) parts.push(`u:${key.userId}`);

    // Sort for determinism
    return parts.sort().join("|");
  }

  get<T>(key: CacheKey): T | null {
    const cacheKey = this.buildKey(key);
    const entry = this.entries.get(cacheKey);

    if (!entry) {
      this.misses++;
      log.debug({ cacheKey }, "Cache miss");
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(cacheKey);
      this.misses++;
      log.debug({ cacheKey }, "Cache expired");
      return null;
    }

    // Update hit count
    entry.hitCount++;
    this.hits++;

    log.debug(
      { cacheKey, hitCount: entry.hitCount },
      "Cache hit"
    );

    return entry.value as T;
  }

  set<T>(key: CacheKey, value: T, ttlMs?: number, source?: string): void {
    const cacheKey = this.buildKey(key);
    const now = Date.now();
    const ttl = Math.min(ttlMs ?? this.maxTtlMs, this.maxTtlMs);

    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + ttl,
      hitCount: 0,
      source,
    };

    // Evict if at capacity
    if (this.entries.size >= this.maxEntries) {
      this.evictLRU();
    }

    this.entries.set(cacheKey, entry as CacheEntry<unknown>);

    log.debug(
      { cacheKey, ttl, source },
      "Cache set"
    );
  }

  delete(key: CacheKey): boolean {
    const cacheKey = this.buildKey(key);
    const existed = this.entries.delete(cacheKey);
    if (existed) {
      log.debug({ cacheKey }, "Cache deleted");
    }
    return existed;
  }

  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    log.info({ count }, "Cache cleared");
  }

  stats(): CacheStats {
    const entries = Array.from(this.entries.values());
    const now = Date.now();

    let expiredCount = 0;
    let oldest = now;
    let newest = 0;
    let memoryEstimate = 0;

    for (const entry of entries) {
      if (now > entry.expiresAt) expiredCount++;
      if (entry.createdAt < oldest) oldest = entry.createdAt;
      if (entry.createdAt > newest) newest = entry.createdAt;

      // Rough memory estimate
      const valueSize = JSON.stringify(entry.value).length * 2; // UTF-16
      memoryEstimate += valueSize + 64; // overhead
    }

    const total = this.hits + this.misses;
    return {
      totalEntries: entries.length,
      totalHits: this.hits,
      totalMisses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      memoryEstimateBytes: memoryEstimate,
      expiredEntries: expiredCount,
      oldestEntry: oldest === now ? 0 : oldest,
      newestEntry: newest,
    };
  }

  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      log.info({ pruned }, "Cache pruned");
    }

    return pruned;
  }

  private evictLRU(): void {
    // Find entry with lowest hit count (LRU approximation)
    let lruKey: string | null = null;
    let lruHits = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.hitCount < lruHits) {
        lruHits = entry.hitCount;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.entries.delete(lruKey);
      log.debug({ lruKey, lruHits }, "LRU entry evicted");
    }
  }

  /**
   * Invalidate entries by session ID.
   */
  invalidateBySession(sessionId: string): number {
    let invalidated = 0;
    for (const [key] of this.entries) {
      if (key.includes(`s:${sessionId}`)) {
        this.entries.delete(key);
        invalidated++;
      }
    }
    if (invalidated > 0) {
      log.info({ sessionId, invalidated }, "Session cache invalidated");
    }
    return invalidated;
  }

  /**
   * Invalidate entries by user ID.
   */
  invalidateByUser(userId: string): number {
    let invalidated = 0;
    for (const [key] of this.entries) {
      if (key.includes(`u:${userId}`)) {
        this.entries.delete(key);
        invalidated++;
      }
    }
    if (invalidated > 0) {
      log.info({ userId, invalidated }, "User cache invalidated");
    }
    return invalidated;
  }
}

// ─── Specialized Cache Layers ─────────────────────────────────────────────────

/**
 * STT result cache for repeated phrases.
 */
export class SttResultCache extends VoiceCacheImpl {
  constructor() {
    super({ maxEntries: 500, maxTtlMs: 10 * 60 * 1000 }); // 10 min TTL
  }

  getStt(text: string, language: string): string | null {
    return this.get<string>({ text, language, intent: "stt" });
  }

  setStt(text: string, language: string, result: string): void {
    this.set({ text, language, intent: "stt" }, result, undefined, "whisper");
  }
}

/**
 * Intent cache for parsed intents.
 */
export class IntentCache extends VoiceCacheImpl {
  constructor() {
    super({ maxEntries: 200, maxTtlMs: 5 * 60 * 1000 }); // 5 min TTL
  }

  getIntent(normalizedText: string, language: string): { intent: string; confidence: number } | null {
    return this.get<{ intent: string; confidence: number }>({
      normalizedText,
      language,
      intent: "intent",
    });
  }

  setIntent(
    normalizedText: string,
    language: string,
    intent: string,
    confidence: number
  ): void {
    this.set(
      { normalizedText, language, intent: "intent" },
      { intent, confidence },
      undefined,
      "intent-parser"
    );
  }
}

/**
 * Entity cache for extracted entities.
 */
export class EntityCache extends VoiceCacheImpl {
  constructor() {
    super({ maxEntries: 300, maxTtlMs: 5 * 60 * 1000 });
  }

  getEntities(text: string, language: string): Record<string, string[]> | null {
    return this.get<Record<string, string[]>>({ text, language, intent: "entities" });
  }

  setEntities(text: string, language: string, entities: Record<string, string[]>): void {
    this.set({ text, language, intent: "entities" }, entities, undefined, "entity-extractor");
  }
}

// ─── Singleton Exports ─────────────────────────────────────────────────────────

export const voiceCache: VoiceCache = new VoiceCacheImpl();
export const sttCache = new SttResultCache();
export const intentCache = new IntentCache();
export const entityCache = new EntityCache();