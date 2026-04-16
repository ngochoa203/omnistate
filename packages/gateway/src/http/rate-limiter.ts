/**
 * In-memory sliding-window rate limiter for HTTP endpoints.
 *
 * Each IP gets a token bucket with configurable window and max requests.
 * Auth endpoints get a stricter limit to prevent brute-force.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimiterConfig {
  /** Max requests per window (default: 100) */
  maxRequests: number;
  /** Window duration in ms (default: 15 minutes) */
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequests: 100,
  windowMs: 15 * 60 * 1000, // 15 min
};

const AUTH_CONFIG: RateLimiterConfig = {
  maxRequests: 10,
  windowMs: 15 * 60 * 1000, // 15 min
};

const VOICE_CONFIG: RateLimiterConfig = {
  maxRequests: 30,
  windowMs: 15 * 60 * 1000,
};

const buckets = new Map<string, RateBucket>();

// Clean up old buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > 30 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function getConfig(path: string): RateLimiterConfig {
  if (path.startsWith("/api/auth/") || path.startsWith("/api/lan/")) {
    return AUTH_CONFIG;
  }
  if (path.startsWith("/api/voice/")) {
    return VOICE_CONFIG;
  }
  return DEFAULT_CONFIG;
}

/**
 * Check rate limit for a request.
 * Returns true if request is allowed, false if rate-limited.
 * Sets appropriate headers on the response.
 */
export function checkRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  path: string
): boolean {
  const ip = getClientIp(req);
  const config = getConfig(path);
  const key = `${ip}:${path.split("/").slice(0, 3).join("/")}`;
  const now = Date.now();

  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: config.maxRequests, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= config.windowMs) {
    bucket.tokens = config.maxRequests;
    bucket.lastRefill = now;
  }

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", config.maxRequests);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, bucket.tokens - 1));
  res.setHeader(
    "X-RateLimit-Reset",
    Math.ceil((bucket.lastRefill + config.windowMs) / 1000)
  );

  if (bucket.tokens <= 0) {
    res.setHeader("Retry-After", Math.ceil((config.windowMs - elapsed) / 1000));
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
          retryAfterMs: config.windowMs - elapsed,
        },
      })
    );
    return false;
  }

  bucket.tokens--;
  return true;
}

/**
 * Get current rate limit stats (for monitoring/debugging).
 */
export function getRateLimitStats(): {
  totalBuckets: number;
  entries: Array<{ key: string; remaining: number; resetIn: number }>;
} {
  const now = Date.now();
  const entries = Array.from(buckets.entries()).map(([key, bucket]) => ({
    key,
    remaining: bucket.tokens,
    resetIn: Math.max(0, bucket.lastRefill + DEFAULT_CONFIG.windowMs - now),
  }));
  return { totalBuckets: buckets.size, entries };
}
