import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Span } from "./spans.js";
import { logger } from "../utils/logger.js";
import { register } from "../gateway/metrics.js";
import { Histogram, Counter } from "prom-client";

const DEFAULT_TRACE_DIR = join(homedir(), ".omnistate", "traces");

export class JsonlTraceExporter {
  private traceDir: string;

  constructor(traceDir?: string) {
    this.traceDir = traceDir ?? DEFAULT_TRACE_DIR;
  }

  async export(spans: Span[]): Promise<void> {
    if (spans.length === 0) return;
    if (!existsSync(this.traceDir)) {
      mkdirSync(this.traceDir, { recursive: true });
    }
    const traceId = spans[0].traceId;
    const filePath = join(this.traceDir, `${traceId}.jsonl`);
    for (const span of spans) {
      appendFileSync(filePath, JSON.stringify(span) + "\n");
    }
  }
}

export class LangfuseTraceExporter {
  async export(spans: Span[]): Promise<void> {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) return;

    const host = process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";
    const url = `${host}/api/public/ingestion`;

    const batch = spans.map((span) => ({
      id: span.spanId,
      type: span.parentSpanId ? "span-create" : "trace-create",
      body: {
        id: span.spanId,
        traceId: span.traceId,
        ...(span.parentSpanId ? { parentObservationId: span.parentSpanId } : {}),
        name: span.name,
        startTime: new Date(span.startedAt).toISOString(),
        ...(span.endedAt ? { endTime: new Date(span.endedAt).toISOString() } : {}),
        metadata: span.attributes,
        level: span.status === "error" ? "ERROR" : "DEFAULT",
      },
    }));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
        },
        body: JSON.stringify({ batch }),
      });
      if (!res.ok) {
        logger.warn(`[tracing] Langfuse ingestion returned ${res.status}`);
      }
    } catch (err) {
      logger.warn({ err }, "[tracing] Langfuse export failed");
    }
  }
}

const spanDurationHistogram = new Histogram({
  name: "omnistate_span_duration_seconds",
  help: "Duration of traced spans in seconds",
  labelNames: ["span_name"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

const spanTotalCounter = new Counter({
  name: "omnistate_span_total",
  help: "Total number of traced spans",
  labelNames: ["span_name", "status"] as const,
  registers: [register],
});

export class PrometheusTraceExporter {
  async export(spans: Span[]): Promise<void> {
    for (const span of spans) {
      if (span.endedAt !== undefined) {
        const durationSeconds = (span.endedAt - span.startedAt) / 1000;
        spanDurationHistogram.observe({ span_name: span.name }, durationSeconds);
      }
      spanTotalCounter.inc({ span_name: span.name, status: span.status });
    }
  }
}

const _jsonl = new JsonlTraceExporter();
const _langfuse = new LangfuseTraceExporter();
const _prometheus = new PrometheusTraceExporter();

export async function exportTrace(spans: Span[]): Promise<void> {
  await Promise.all([
    _jsonl.export(spans),
    _langfuse.export(spans),
    _prometheus.export(spans),
  ]);
}
