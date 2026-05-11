/**
 * API Advanced Tools — Webhooks, rate limiting, caching.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Webhook Registry
const webhookRegistry = new Map<string, { url: string; events: string[]; secret?: string }>();

export async function registerWebhook(name: string, url: string, events: string[], secret?: string): Promise<boolean> {
  webhookRegistry.set(name, { url, events, secret });
  return true;
}

export async function unregisterWebhook(name: string): Promise<boolean> { return webhookRegistry.delete(name); }

export async function listWebhooks(): Promise<{ name: string; url: string; events: string[] }[]> {
  return Array.from(webhookRegistry.entries()).map(([name, config]) => ({ name, url: config.url, events: config.events }));
}

export async function triggerWebhook(name: string, payload: object): Promise<{ success: boolean; response?: string }> {
  const webhook = webhookRegistry.get(name);
  if (!webhook) return { success: false };
  try {
    const body = JSON.stringify(payload);
    const headers = { "Content-Type": "application/json", "X-Webhook-Event": webhook.events[0] || "manual" };
    const { stdout } = await execAsync(`curl -s -X POST "${webhook.url}" -d '${body}' ${Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(" ")}`, { encoding: "utf-8" });
    return { success: true, response: stdout };
  } catch { return { success: false }; }
}

// Rate Limiting
interface RateLimitRule { windowMs: number; maxRequests: number; hits: Map<number, number>; }
const rateLimits = new Map<string, RateLimitRule>();

export async function configureRateLimit(name: string, windowMs: number, maxRequests: number): Promise<boolean> { rateLimits.set(name, { windowMs, maxRequests, hits: new Map() }); return true; }

export async function checkRateLimit(name: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const rule = rateLimits.get(name);
  if (!rule) return { allowed: true, remaining: Infinity, resetAt: 0 };
  const now = Date.now();
  const windowKey = Math.floor(now / rule.windowMs);
  if (!rule.hits.has(windowKey)) rule.hits.set(windowKey, 0);
  const current = rule.hits.get(windowKey) || 0;
  if (current >= rule.maxRequests) return { allowed: false, remaining: 0, resetAt: (windowKey + 1) * rule.windowMs };
  rule.hits.set(windowKey, current + 1);
  return { allowed: true, remaining: rule.maxRequests - current - 1, resetAt: (windowKey + 1) * rule.windowMs };
}

// API Key Management
const apiKeyStore = new Map<string, { key: string; scopes: string[]; expiresAt?: number; rateLimit: number }>();

export async function createAPIKey(name: string, scopes: string[], options?: { expiresIn?: number; rateLimit?: number }): Promise<string> {
  const crypto = await import("node:crypto");
  const key = crypto.randomBytes(32).toString("hex");
  apiKeyStore.set(name, { key, scopes, expiresAt: options?.expiresIn ? Date.now() + options.expiresIn : undefined, rateLimit: options?.rateLimit || 100 });
  return key;
}

export async function revokeAPIKey(name: string): Promise<boolean> { return apiKeyStore.delete(name); }

export async function validateAPIKey(key: string): Promise<{ valid: boolean; scopes: string[]; rateLimit: number }> {
  for (const [, config] of apiKeyStore) {
    if (config.key === key) {
      if (config.expiresAt && Date.now() > config.expiresAt) return { valid: false, scopes: [], rateLimit: 0 };
      return { valid: true, scopes: config.scopes, rateLimit: config.rateLimit };
    }
  }
  return { valid: false, scopes: [], rateLimit: 0 };
}

// Cache
interface CacheEntry { value: string; expiresAt: number; hits: number; }
const cache = new Map<string, CacheEntry>();

export async function cacheSet(key: string, value: string, ttlSeconds = 3600): Promise<boolean> { cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000, hits: 0 }); return true; }
export async function cacheGet(key: string): Promise<string | null> {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  entry.hits++;
  return entry.value;
}

export async function cacheDelete(key: string): Promise<boolean> { return cache.delete(key); }
export async function cacheClear(): Promise<number> { const size = cache.size; cache.clear(); return size; }
export async function cacheStats(): Promise<{ size: number; totalHits: number }> { let totalHits = 0; for (const entry of cache.values()) totalHits += entry.hits; return { size: cache.size, totalHits }; }

export async function transformResponse(data: object, format: "json" | "xml" | "csv"): Promise<string> {
  if (format === "json") return JSON.stringify(data, null, 2);
  if (format === "csv") { const entries = Object.entries(data); return `${entries.map(([k]) => k).join(",")}\n${entries.map(([, v]) => String(v)).join(",")}`; }
  return `<?xml version="1.0"?><root>${JSON.stringify(data)}</root>`;
}

export class APIAdvancedLayer {
  registerWebhook = registerWebhook; unregisterWebhook = unregisterWebhook; listWebhooks = listWebhooks; triggerWebhook = triggerWebhook;
  configureRateLimit = configureRateLimit; checkRateLimit = checkRateLimit;
  createAPIKey = createAPIKey; revokeAPIKey = revokeAPIKey; validateAPIKey = validateAPIKey;
  cacheSet = cacheSet; cacheGet = cacheGet; cacheDelete = cacheDelete; cacheClear = cacheClear; cacheStats = cacheStats;
  transformResponse = transformResponse;
}
