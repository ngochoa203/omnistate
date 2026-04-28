import { randomBytes } from "node:crypto";

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number; // epoch ms
  endedAt?: number;
  status: "ok" | "error" | "cancelled";
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, string | number | boolean> }>;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export function createSpanId(): string {
  return randomBytes(8).toString("hex"); // 16-char hex
}

export function createTraceId(): string {
  return randomBytes(16).toString("hex"); // 32-char hex
}
