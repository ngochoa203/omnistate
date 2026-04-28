import type { Span, SpanContext } from "./spans.js";
import { createSpanId, createTraceId } from "./spans.js";

export class TraceContext {
  readonly traceId: string;
  private spans: Map<string, Span> = new Map();
  private activeStack: SpanContext[] = [];

  constructor(traceId?: string) {
    this.traceId = traceId ?? createTraceId();
  }

  startSpan(name: string, attributes?: Record<string, string | number | boolean>): SpanContext {
    const spanId = createSpanId();
    const parentSpanId = this.activeStack.length > 0
      ? this.activeStack[this.activeStack.length - 1].spanId
      : undefined;

    const span: Span = {
      traceId: this.traceId,
      spanId,
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      name,
      startedAt: Date.now(),
      status: "ok",
      attributes: attributes ?? {},
      events: [],
    };

    this.spans.set(spanId, span);
    const ctx: SpanContext = { traceId: this.traceId, spanId };
    this.activeStack.push(ctx);
    return ctx;
  }

  endSpan(ctx: SpanContext, status: "ok" | "error" | "cancelled" = "ok"): void {
    const span = this.spans.get(ctx.spanId);
    if (span) {
      span.endedAt = Date.now();
      span.status = status;
    }
    // Pop from activeStack only if it matches (search from top)
    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      if (this.activeStack[i].spanId === ctx.spanId) {
        this.activeStack.splice(i, 1);
        break;
      }
    }
  }

  addEvent(ctx: SpanContext, name: string, attrs?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(ctx.spanId);
    if (span) {
      span.events.push({ name, timestamp: Date.now(), ...(attrs ? { attributes: attrs } : {}) });
    }
  }

  getAllSpans(): Span[] {
    return Array.from(this.spans.values());
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  currentSpan(): SpanContext | undefined {
    return this.activeStack.length > 0
      ? this.activeStack[this.activeStack.length - 1]
      : undefined;
  }
}
