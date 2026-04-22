import { Registry, Counter, Histogram, Gauge } from "prom-client";

export const register = new Registry();

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 1, 3, 10],
  registers: [register],
});

export const wsConnectionsGauge = new Gauge({
  name: "ws_connections_active",
  help: "Active WebSocket connections",
  registers: [register],
});
