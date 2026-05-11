/**
 * Aggregation Tools — Advanced Layer (API 92)
 * Implements: Real-time aggregation, streaming, windowing operations
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface AggregationWindow {
  id: string;
  type: "tumbling" | "sliding" | "session";
  size: number; // ms
  emitFrequency?: number;
}

export interface AggregationResult {
  windowId: string;
  startTime: Date;
  endTime: Date;
  metrics: Record<string, number>;
  count: number;
}

export async function createAggregationWindow(config: {
  type: "tumbling" | "sliding" | "session";
  size: number;
}): Promise<AggregationWindow> {
  return {
    id: `window_${Date.now()}`,
    type: config.type,
    size: config.size,
    emitFrequency: config.type === "tumbling" ? config.size : config.size / 2
  };
}

export async function aggregateData<T>(
  data: T[],
  groupBy: (item: T) => string,
  aggregator: (items: T[]) => Record<string, number>
): Promise<Record<string, Record<string, number>>> {
  const groups = new Map<string, T[]>();
  
  for (const item of data) {
    const key = groupBy(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  
  const results: Record<string, Record<string, number>> = {};
  
  for (const [key, items] of groups.entries()) {
    results[key] = aggregator(items);
  }
  
  return results;
}

export class AggregationLayer {
  createWindow = createAggregationWindow;
  aggregate = aggregateData;
}
