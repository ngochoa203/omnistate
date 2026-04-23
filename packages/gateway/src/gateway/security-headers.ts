import type { ServerResponse } from "node:http";

const ALLOWED_ORIGINS: string[] = (
  process.env.OMNISTATE_ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const CORS_ALLOW_HEADERS = "content-type, authorization, x-request-id";

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("Content-Security-Policy", "default-src 'self'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function applyCorsHeaders(res: ServerResponse, origin: string | undefined): void {
  if (!origin) return;
  if (!ALLOWED_ORIGINS.includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export function applyPreflightHeaders(res: ServerResponse, origin: string | undefined): void {
  applyCorsHeaders(res, origin);
  res.setHeader("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
}
