import { logger } from "../utils/logger.js";

export interface OSEvent {
  id: string;
  type: string; // "app.opened"|"app.closed"|"file.created"|"file.modified"|"notification.received"|"battery.low"|"network.changed"|"display.sleep"|"clipboard.changed"
  source: string; // "os-firehose"|"trigger-engine"|"plugin"|"user"
  payload: Record<string, unknown>;
  timestamp: number;
}

type EventHandler = (event: OSEvent) => void | Promise<void>;

function globMatch(pattern: string, type: string): boolean {
  const patternParts = pattern.split(".");
  const typeParts = type.split(".");

  let pi = 0;
  let ti = 0;

  while (pi < patternParts.length && ti < typeParts.length) {
    const p = patternParts[pi];
    if (p === "**") {
      // ** matches zero or more segments
      pi++;
      if (pi >= patternParts.length) return true;
      // Find the next matching position
      while (ti < typeParts.length) {
        if (globMatch(patternParts.slice(pi).join("."), typeParts.slice(ti).join("."))) return true;
        ti++;
      }
      return false;
    } else if (p === "*") {
      // * matches exactly one segment
      pi++;
      ti++;
    } else if (p === typeParts[ti]) {
      pi++;
      ti++;
    } else {
      return false;
    }
  }

  // Handle trailing ** in pattern
  while (pi < patternParts.length && patternParts[pi] === "**") pi++;

  return pi === patternParts.length && ti === typeParts.length;
}

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private patternHandlers: Map<string, Set<EventHandler>> = new Map();
  private recentEvents: OSEvent[] = [];
  private maxRecent = 1000;

  emit(event: OSEvent): void {
    // Add to ring buffer
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.shift();
    }

    // Exact match handlers
    const exact = this.handlers.get(event.type);
    if (exact) {
      for (const handler of exact) {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch((err) => logger.error({ err }, `[event-bus] handler error for ${event.type}`));
          }
        } catch (err) {
          logger.error({ err }, `[event-bus] handler error for ${event.type}`);
        }
      }
    }

    // Pattern match handlers
    for (const [pattern, handlers] of this.patternHandlers) {
      if (globMatch(pattern, event.type)) {
        for (const handler of handlers) {
          try {
            const result = handler(event);
            if (result instanceof Promise) {
              result.catch((err) => logger.error({ err }, `[event-bus] pattern handler error for ${pattern}`));
            }
          } catch (err) {
            logger.error({ err }, `[event-bus] pattern handler error for ${pattern}`);
          }
        }
      }
    }
  }

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  onPattern(glob: string, handler: EventHandler): () => void {
    if (!this.patternHandlers.has(glob)) {
      this.patternHandlers.set(glob, new Set());
    }
    this.patternHandlers.get(glob)!.add(handler);
    return () => {
      this.patternHandlers.get(glob)?.delete(handler);
    };
  }

  getRecent(opts?: { type?: string; limit?: number; since?: number }): OSEvent[] {
    let events = this.recentEvents;

    if (opts?.type) {
      events = events.filter((e) => e.type === opts.type);
    }
    if (opts?.since !== undefined) {
      events = events.filter((e) => e.timestamp > opts.since!);
    }

    const limit = opts?.limit ?? 100;
    return events.slice(-limit);
  }
}
