import { Registry, Counter, Histogram, Gauge } from "prom-client";

export type MetricName =
  | "wake_detection_latency_ms"
  | "verification_latency_ms"
  | "stt_latency_ms"
  | "tts_latency_ms"
  | "end_to_end_latency_ms"
  | "enrollment_quality_score";

export type ErrorType =
  | "AUDIO_TOO_LARGE"
  | "NO_PROFILE"
  | "EMBEDDING_FAILED"
  | "VERIFICATION_FAILED"
  | "ENROLLMENT_FAILED"
  | "WAKE_DETECTION_FAILED"
  | "STT_FAILED"
  | "TTS_FAILED"
  | "UNKNOWN";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface MetricSummary {
  counts: Record<string, number>;
  sums: Record<string, number>;
  countsByTag: Record<string, Record<string, number>>;
  healthStatus: HealthStatus;
  alerts: string[];
}

interface Duration {
  seconds?: number;
  minutes?: number;
  hours?: number;
}

interface MetricPoint {
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

const HEALTHY_LATENCY_P95_MS = 500;
const DEGRADED_LATENCY_P95_MS = 1500;
const ERROR_RATE_THRESHOLD = 0.05;
const DEGRADED_ERROR_RATE_THRESHOLD = 0.15;

const register = new Registry();

const counters = {
  errors: new Counter({
    name: "voice_errors_total",
    help: "Total voice errors by type",
    labelNames: ["error_type"] as const,
    registers: [register],
  }),
  wakeDetections: new Counter({
    name: "voice_wake_detections_total",
    help: "Total wake detections",
    registers: [register],
  }),
  verifications: new Counter({
    name: "voice_verifications_total",
    help: "Total verifications",
    labelNames: ["result"] as const,
    registers: [register],
  }),
  enrollments: new Counter({
    name: "voice_enrollments_total",
    help: "Total enrollment attempts",
    labelNames: ["result"] as const,
    registers: [register],
  }),
  sttRequests: new Counter({
    name: "voice_stt_requests_total",
    help: "Total STT requests",
    labelNames: ["model"] as const,
    registers: [register],
  }),
  ttsRequests: new Counter({
    name: "voice_tts_requests_total",
    help: "Total TTS requests",
    registers: [register],
  }),
};

const histograms = {
  wakeLatency: new Histogram({
    name: "voice_wake_detection_latency_ms",
    help: "Wake detection latency in ms",
    buckets: [10, 25, 50, 100, 200, 500, 1000],
    registers: [register],
  }),
  verificationLatency: new Histogram({
    name: "voice_verification_latency_ms",
    help: "Verification latency in ms",
    buckets: [50, 100, 200, 500, 1000, 2000, 5000],
    registers: [register],
  }),
  sttLatency: new Histogram({
    name: "voice_stt_latency_ms",
    help: "STT latency in ms",
    labelNames: ["model"] as const,
    buckets: [100, 250, 500, 1000, 2000, 5000, 10000],
    registers: [register],
  }),
  ttsLatency: new Histogram({
    name: "voice_tts_latency_ms",
    help: "TTS latency in ms",
    buckets: [50, 100, 200, 500, 1000, 2000],
    registers: [register],
  }),
  endToEndLatency: new Histogram({
    name: "voice_end_to_end_latency_ms",
    help: "End-to-end latency in ms",
    buckets: [500, 1000, 2000, 5000, 10000, 30000, 60000],
    registers: [register],
  }),
  enrollmentQuality: new Histogram({
    name: "voice_enrollment_quality_score",
    help: "Enrollment quality score",
    buckets: [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
    registers: [register],
  }),
};

const gauges = {
  activeEnrollmentSessions: new Gauge({
    name: "voice_active_enrollment_sessions",
    help: "Number of active enrollment sessions",
    registers: [register],
  }),
  lastWakeLatencyP95: new Gauge({
    name: "voice_last_wake_latency_p95_ms",
    help: "Last recorded wake latency P95 in ms",
    registers: [register],
  }),
  lastVerificationLatencyP95: new Gauge({
    name: "voice_last_verification_latency_p95_ms",
    help: "Last recorded verification latency P95 in ms",
    registers: [register],
  }),
  lastSttLatencyP95: new Gauge({
    name: "voice_last_stt_latency_p95_ms",
    help: "Last recorded STT latency P95 in ms",
    registers: [register],
  }),
  lastTtsLatencyP95: new Gauge({
    name: "voice_last_tts_latency_p95_ms",
    help: "Last recorded TTS latency P95 in ms",
    registers: [register],
  }),
};

const rawMetrics = new Map<string, MetricPoint[]>();
const MAX_RAW_POINTS = 1000;

function getDurationMs(duration?: Duration): number {
  if (!duration) return 60_000;
  const { seconds = 0, minutes = 0, hours = 0 } = duration;
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function isWithinTimeRange(timestamp: number, maxAgeMs: number): boolean {
  return Date.now() - timestamp <= maxAgeMs;
}

function computePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function assessHealth(
  wakeP95: number,
  verifyP95: number,
  sttP95: number,
  ttsP95: number,
  errorRate: number,
): HealthStatus {
  if (
    wakeP95 > DEGRADED_LATENCY_P95_MS ||
    verifyP95 > DEGRADED_LATENCY_P95_MS ||
    sttP95 > DEGRADED_LATENCY_P95_MS ||
    ttsP95 > DEGRADED_LATENCY_P95_MS ||
    errorRate > DEGRADED_ERROR_RATE_THRESHOLD
  ) {
    return "unhealthy";
  }
  if (
    wakeP95 > HEALTHY_LATENCY_P95_MS ||
    verifyP95 > HEALTHY_LATENCY_P95_MS ||
    sttP95 > HEALTHY_LATENCY_P95_MS ||
    ttsP95 > HEALTHY_LATENCY_P95_MS ||
    errorRate > ERROR_RATE_THRESHOLD
  ) {
    return "degraded";
  }
  return "healthy";
}

function generateAlerts(
  health: HealthStatus,
  wakeP95: number,
  verifyP95: number,
  sttP95: number,
  ttsP95: number,
  errorRate: number,
): string[] {
  const alerts: string[] = [];
  if (health === "unhealthy") {
    if (wakeP95 > DEGRADED_LATENCY_P95_MS) {
      alerts.push(`Wake detection P95 latency critically high: ${Math.round(wakeP95)}ms`);
    }
    if (verifyP95 > DEGRADED_LATENCY_P95_MS) {
      alerts.push(`Verification P95 latency critically high: ${Math.round(verifyP95)}ms`);
    }
    if (sttP95 > DEGRADED_LATENCY_P95_MS) {
      alerts.push(`STT P95 latency critically high: ${Math.round(sttP95)}ms`);
    }
    if (ttsP95 > DEGRADED_LATENCY_P95_MS) {
      alerts.push(`TTS P95 latency critically high: ${Math.round(ttsP95)}ms`);
    }
    if (errorRate > DEGRADED_ERROR_RATE_THRESHOLD) {
      alerts.push(`Error rate critically high: ${(errorRate * 100).toFixed(1)}%`);
    }
  } else if (health === "degraded") {
    if (wakeP95 > HEALTHY_LATENCY_P95_MS) {
      alerts.push(`Wake detection P95 latency elevated: ${Math.round(wakeP95)}ms`);
    }
    if (verifyP95 > HEALTHY_LATENCY_P95_MS) {
      alerts.push(`Verification P95 latency elevated: ${Math.round(verifyP95)}ms`);
    }
    if (sttP95 > HEALTHY_LATENCY_P95_MS) {
      alerts.push(`STT P95 latency elevated: ${Math.round(sttP95)}ms`);
    }
    if (ttsP95 > HEALTHY_LATENCY_P95_MS) {
      alerts.push(`TTS P95 latency elevated: ${Math.round(ttsP95)}ms`);
    }
    if (errorRate > ERROR_RATE_THRESHOLD) {
      alerts.push(`Error rate elevated: ${(errorRate * 100).toFixed(1)}%`);
    }
  }
  return alerts;
}

export function recordMetric(name: string, value: number, tags?: Record<string, string>): void {
  const point: MetricPoint = { value, timestamp: Date.now(), tags };
  const existing = rawMetrics.get(name) ?? [];
  existing.push(point);
  if (existing.length > MAX_RAW_POINTS) {
    existing.splice(0, existing.length - MAX_RAW_POINTS);
  }
  rawMetrics.set(name, existing);

  switch (name) {
    case "wake_detection_latency_ms":
      histograms.wakeLatency.observe(value);
      gauges.lastWakeLatencyP95.set(computePercentile(existing.map((p) => p.value), 0.95));
      break;
    case "verification_latency_ms":
      histograms.verificationLatency.observe(value);
      gauges.lastVerificationLatencyP95.set(computePercentile(existing.map((p) => p.value), 0.95));
      break;
    case "stt_latency_ms":
      if (tags?.model) {
        histograms.sttLatency.labels(tags.model).observe(value);
        gauges.lastSttLatencyP95.set(computePercentile(existing.filter((p) => p.tags?.model === tags.model).map((p) => p.value), 0.95));
      }
      break;
    case "tts_latency_ms":
      histograms.ttsLatency.observe(value);
      gauges.lastTtsLatencyP95.set(computePercentile(existing.map((p) => p.value), 0.95));
      break;
    case "end_to_end_latency_ms":
      histograms.endToEndLatency.observe(value);
      break;
    case "enrollment_quality_score":
      histograms.enrollmentQuality.observe(value);
      break;
    case "error":
      if (tags?.type) {
        counters.errors.labels(tags.type).inc();
      }
      break;
    case "wake_detection":
      counters.wakeDetections.inc();
      break;
    case "verification":
      counters.verifications.labels(tags?.result ?? "unknown").inc();
      break;
    case "enrollment":
      counters.enrollments.labels(tags?.result ?? "unknown").inc();
      break;
    case "stt_request":
      if (tags?.model) {
        counters.sttRequests.labels(tags.model).inc();
      }
      break;
    case "tts_request":
      counters.ttsRequests.inc();
      break;
  }
}

export function getMetrics(timeRange?: Duration): MetricSummary {
  const maxAgeMs = getDurationMs(timeRange);

  const counts: Record<string, number> = {};
  const sums: Record<string, number> = {};
  const countsByTag: Record<string, Record<string, number>> = {};

  for (const [name, points] of rawMetrics) {
    const filtered = points.filter((p) => isWithinTimeRange(p.timestamp, maxAgeMs));
    if (filtered.length === 0) {
      counts[name] = 0;
      sums[name] = 0;
      continue;
    }
    counts[name] = filtered.length;
    sums[name] = filtered.reduce((s, p) => s + p.value, 0);
    countsByTag[name] = {};
    for (const p of filtered) {
      if (p.tags) {
        for (const [k, v] of Object.entries(p.tags)) {
          countsByTag[name][`${k}:${v}`] = (countsByTag[name][`${k}:${v}`] ?? 0) + 1;
        }
      }
    }
  }

  const wakePoints = (rawMetrics.get("wake_detection_latency_ms") ?? [])
    .filter((p) => isWithinTimeRange(p.timestamp, maxAgeMs))
    .map((p) => p.value);
  const verifyPoints = (rawMetrics.get("verification_latency_ms") ?? [])
    .filter((p) => isWithinTimeRange(p.timestamp, maxAgeMs))
    .map((p) => p.value);
  const sttPoints = (rawMetrics.get("stt_latency_ms") ?? [])
    .filter((p) => isWithinTimeRange(p.timestamp, maxAgeMs))
    .map((p) => p.value);
  const ttsPoints = (rawMetrics.get("tts_latency_ms") ?? [])
    .filter((p) => isWithinTimeRange(p.timestamp, maxAgeMs))
    .map((p) => p.value);

  const wakeP95 = computePercentile(wakePoints, 0.95);
  const verifyP95 = computePercentile(verifyPoints, 0.95);
  const sttP95 = computePercentile(sttPoints, 0.95);
  const ttsP95 = computePercentile(ttsPoints, 0.95);

  const errorCount = counts["error"] ?? 0;
  const totalRequests =
    (counts["wake_detection"] ?? 0) +
    (counts["verification"] ?? 0) +
    (counts["stt_request"] ?? 0) +
    (counts["tts_request"] ?? 0);
  const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

  const health = assessHealth(wakeP95, verifyP95, sttP95, ttsP95, errorRate);
  const alerts = generateAlerts(health, wakeP95, verifyP95, sttP95, ttsP95, errorRate);

  return { counts, sums, countsByTag, healthStatus: health, alerts };
}

export function reset(): void {
  rawMetrics.clear();
  register.resetMetrics();
}

export async function exportMetrics(): Promise<string> {
  return register.metrics();
}

export function getHealthStatus(timeRange?: Duration): HealthStatus {
  return getMetrics(timeRange).healthStatus;
}

export function wrapVerification<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
): (...args: Parameters<T>) => Promise<unknown> {
  return async (...args: Parameters<T>) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const latency = Date.now() - start;
      recordMetric("verification_latency_ms", latency);
      if ((result as { match?: boolean }).match !== undefined) {
        recordMetric("verification", 1, {
          result: String((result as { match: boolean }).match),
        });
      }
      return result;
    } catch (err) {
      const latency = Date.now() - start;
      recordMetric("verification_latency_ms", latency);
      recordMetric("error", 1, { type: "VERIFICATION_FAILED" });
      throw err;
    }
  };
}

export function wrapStt<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  sttModel?: string,
): (...args: Parameters<T>) => Promise<unknown> {
  return async (...args: Parameters<T>) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const latency = Date.now() - start;
      recordMetric("stt_latency_ms", latency, { model: sttModel ?? "default" });
      recordMetric("stt_request", 1, { model: sttModel ?? "default" });
      return result;
    } catch (err) {
      const latency = Date.now() - start;
      recordMetric("stt_latency_ms", latency, { model: sttModel ?? "default" });
      recordMetric("error", 1, { type: "STT_FAILED" });
      throw err;
    }
  };
}

export function wrapTts<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
): (...args: Parameters<T>) => Promise<unknown> {
  return async (...args: Parameters<T>) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const latency = Date.now() - start;
      recordMetric("tts_latency_ms", latency);
      recordMetric("tts_request", 1);
      return result;
    } catch (err) {
      const latency = Date.now() - start;
      recordMetric("tts_latency_ms", latency);
      recordMetric("error", 1, { type: "TTS_FAILED" });
      throw err;
    }
  };
}

export function wrapWakeDetection<T extends (...args: unknown[]) => unknown>(
  fn: T,
): (...args: Parameters<T>) => unknown {
  return (...args: Parameters<T>) => {
    const start = Date.now();
    try {
      const result = fn(...args);
      const latency = Date.now() - start;
      recordMetric("wake_detection_latency_ms", latency);
      recordMetric("wake_detection", 1);
      return result;
    } catch (err) {
      const latency = Date.now() - start;
      recordMetric("wake_detection_latency_ms", latency);
      recordMetric("error", 1, { type: "WAKE_DETECTION_FAILED" });
      throw err;
    }
  };
}

export function recordEnrollmentQuality(score: number): void {
  recordMetric("enrollment_quality_score", score);
}

export function recordEnrollmentResult(success: boolean): void {
  recordMetric("enrollment", 1, { result: String(success) });
}

export function recordEndToEndLatency(latencyMs: number): void {
  recordMetric("end_to_end_latency_ms", latencyMs);
}

let summaryInterval: ReturnType<typeof setInterval> | null = null;

export function startPeriodicSummary(intervalMs = 60_000): void {
  if (summaryInterval) return;
  summaryInterval = setInterval(() => {
    const metrics = getMetrics({ minutes: 5 });
    const lines = [
      "[Voice Metrics] Periodic summary",
      `  Health: ${metrics.healthStatus}`,
      `  Wake P95: ${metrics.counts["wake_detection_latency_ms"] ?? 0} samples`,
      `  Verify P95: ${metrics.counts["verification_latency_ms"] ?? 0} samples`,
      `  STT: ${metrics.counts["stt_latency_ms"] ?? 0} samples`,
      `  TTS: ${metrics.counts["tts_latency_ms"] ?? 0} samples`,
      `  E2E: ${metrics.counts["end_to_end_latency_ms"] ?? 0} samples`,
    ];
    if (metrics.alerts.length > 0) {
      lines.push("  Alerts:");
      for (const alert of metrics.alerts) {
        lines.push(`    - ${alert}`);
      }
    }
    console.log(lines.join("\n"));
  }, intervalMs);
}

export function stopPeriodicSummary(): void {
  if (summaryInterval) {
    clearInterval(summaryInterval);
    summaryInterval = null;
  }
}