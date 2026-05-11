/**
 * Metrics Collection Tools — Advanced Layer (API 67)
 * Implements: Custom metrics, counters, gauges, histograms, health checks
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);

export interface MetricPoint {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

export interface HealthCheck {
  name: string;
  status: "healthy" | "degraded" | "down";
  latency: number;
  lastCheck: Date;
}

const metricsStore = new Map<string, number[]>();

export async function recordMetric(name: string, value: number, labels?: Record<string, string>): Promise<boolean> {
  try {
    if (!metricsStore.has(name)) {
      metricsStore.set(name, []);
    }
    metricsStore.get(name)!.push(value);
    
    const metric: MetricPoint = { name, value, labels: labels || {}, timestamp: new Date() };
    const logPath = path.join(process.cwd(), "metrics", `${name}.jsonl`);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, JSON.stringify(metric) + "\n");
    
    return true;
  } catch {
    return false;
  }
}

export async function incrementCounter(name: string, delta: number = 1): Promise<number> {
  const current = metricsStore.get(name) || [0];
  const newValue = (current[current.length - 1] || 0) + delta;
  current.push(newValue);
  metricsStore.set(name, current);
  return newValue;
}

export async function setGauge(name: string, value: number): Promise<boolean> {
  metricsStore.set(name, [value]);
  return true;
}

export async function observeHistogram(name: string, value: number): Promise<boolean> {
  return recordMetric(`histogram_${name}`, value);
}

export async function getMetricSummary(name: string): Promise<{
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}> {
  const values = metricsStore.get(name) || [];
  if (values.length === 0) {
    return { count: 0, sum: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  
  const percentile = (p: number) => {
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)];
  };
  
  return {
    count: values.length,
    sum,
    avg: sum / values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99)
  };
}

export async function runHealthCheck(endpoint: string): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { stdout } = await execAsync(
      `curl -s -o /dev/null -w "%{http_code}" "${endpoint}" 2>/dev/null || echo "000"`,
      { encoding: "utf-8" }
    );
    const latency = Date.now() - start;
    const status = stdout.trim().startsWith("2") ? "healthy" : stdout.trim().startsWith("5") ? "down" : "degraded";
    
    return { name: endpoint, status, latency, lastCheck: new Date() };
  } catch {
    return { name: endpoint, status: "down", latency: Date.now() - start, lastCheck: new Date() };
  }
}

export async function checkAllServicesHealth(): Promise<{
  overall: "healthy" | "degraded" | "down";
  services: HealthCheck[];
}> {
  const services = ["localhost:3000", "localhost:5432", "localhost:6379"];
  const results = await Promise.all(services.map(s => runHealthCheck(`http://${s}/health`)));
  
  const overall = results.every(r => r.status === "healthy")
    ? "healthy"
    : results.some(r => r.status === "down")
      ? "down"
      : "degraded";
  
  return { overall, services: results };
}

export async function exportPrometheusMetrics(): Promise<string> {
  const lines: string[] = [];
  
  for (const [name, values] of metricsStore.entries()) {
    const value = values[values.length - 1] || 0;
    lines.push(`${name} ${value}`);
  }
  
  return lines.join("\n");
}

export class MetricsCollectionLayer {
  record = recordMetric;
  increment = incrementCounter;
  setGauge = setGauge;
  observe = observeHistogram;
  getSummary = getMetricSummary;
  healthCheck = runHealthCheck;
  checkAllServices = checkAllServicesHealth;
  exportPrometheus = exportPrometheusMetrics;
}
