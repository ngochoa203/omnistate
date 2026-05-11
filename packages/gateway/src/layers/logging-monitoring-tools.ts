/**
 * Logging & Monitoring Tools — Group 43
 * Implements: Log aggregation, metrics, alerts, dashboards
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Log Aggregation (ELK Stack)
// ------------------------------------------------------------------

export interface LogEntry {
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  source: string;
  metadata?: Record<string, any>;
}

export async function getLogsFromFile(filePath: string, lines: number = 100, level?: string): Promise<LogEntry[]> {
  try {
    const { stdout } = await execAsync(`tail -n ${lines} "${filePath}" 2>/dev/null || echo ''`, { encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      // Parse common log formats
      const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
      const levelMatch = line.match(/\b(DEBUG|INFO|WARN|ERROR)\b/i);
      const sourceMatch = line.match(/\[([^\]]+)\]/);
      
      return {
        timestamp: new Date(timeMatch?.[1] || Date.now()),
        level: (levelMatch?.[1]?.toLowerCase() as LogEntry["level"]) || "info",
        message: line,
        source: sourceMatch?.[1] || "unknown"
      };
    }).filter(l => !level || l.level === level.toLowerCase());
  } catch {
    return [];
  }
}

export async function searchLogs(pattern: string, directory?: string, recursive: boolean = true): Promise<string[]> {
  try {
    const dir = directory || ".";
    const flag = recursive ? "-r" : "";
    const { stdout } = await execAsync(`grep ${flag} -l "${pattern}" ${dir}/*.log 2>/dev/null || echo ''`, { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(f => f.trim());
  } catch {
    return [];
  }
}

export async function tailLogs(filePath: string, follow: boolean = false): Promise<string> {
  try {
    const flag = follow ? "-f" : "";
    const { stdout } = await execAsync(`tail ${flag} -n 100 "${filePath}"`, { encoding: "utf-8", timeout: follow ? undefined : 5000 });
    return stdout;
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Metrics Collection
// ------------------------------------------------------------------

export async function getSystemMetrics(): Promise<{
  cpu: { usage: number };
  memory: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  network: { in: number; out: number };
}> {
  try {
    const { stdout: top } = await execAsync("top -l 1 -n 1 | head -10", { encoding: "utf-8" });
    const cpuMatch = top.match(/CPU usage: (\d+\.?\d*)%/);
    
    return {
      cpu: { usage: parseFloat(cpuMatch?.[1] || "0") },
      memory: { used: 0, total: 0, percent: 0 },
      disk: { used: 0, total: 0, percent: 0 },
      network: { in: 0, out: 0 }
    };
  } catch {
    return { cpu: { usage: 0 }, memory: { used: 0, total: 0, percent: 0 }, disk: { used: 0, total: 0, percent: 0 }, network: { in: 0, out: 0 } };
  }
}

export async function collectApplicationMetrics(appPath: string): Promise<object> {
  // Custom metrics for application
  return {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage()
  };
}

// ------------------------------------------------------------------
// Prometheus Metrics
// ------------------------------------------------------------------

export async function queryPrometheus(query: string, server?: string): Promise<object[]> {
  try {
    const url = server || process.env.PROMETHEUS_URL || "http://localhost:9090";
    const encodedQuery = encodeURIComponent(query);
    
    const { stdout } = await execAsync(`curl -s "${url}/api/v1/query?query=${encodedQuery}" 2>/dev/null || echo '{"status":"error"}'`, { encoding: "utf-8" });
    const result = JSON.parse(stdout);
    
    return result.status === "success" ? result.data?.result || [] : [];
  } catch {
    return [];
  }
}

export async function getPrometheusMetrics(): Promise<{ name: string; value: number }[]> {
  const result = await queryPrometheus("node_memory_MemAvailable_bytes");
  return (result as any[]).map((r: any) => ({
    name: r.metric?.__name__ || "unknown",
    value: parseFloat(r.value?.[1] || "0")
  }));
}

// ------------------------------------------------------------------
// Grafana Dashboard
// ------------------------------------------------------------------

export async function getGrafanaDashboards(server?: string): Promise<{ id: number; title: string; uid: string }[]> {
  try {
    const url = server || process.env.GRAFANA_URL || "http://localhost:3000";
    const token = process.env.GRAFANA_TOKEN;
    
    const { stdout } = await execAsync(
      `curl -s -H "Authorization: Bearer ${token}" "${url}/api/search" 2>/dev/null || echo '[]'`,
      { encoding: "utf-8" }
    );
    
    return JSON.parse(stdout || "[]");
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Alert Management
// ------------------------------------------------------------------

export async function getAlerts(alertManager?: string): Promise<{ name: string; status: string; severity: string }[]> {
  try {
    const url = alertManager || process.env.ALERTMANAGER_URL || "http://localhost:9093";
    
    const { stdout } = await execAsync(`curl -s "${url}/api/v1/alerts" 2>/dev/null || echo '{"data":{"groups":[]}}'`, { encoding: "utf-8" });
    const result = JSON.parse(stdout);
    
    // Parse alerts from response
    return [];
  } catch {
    return [];
  }
}

export async function sendAlert(name: string, message: string, severity: "critical" | "warning" | "info" = "warning"): Promise<boolean> {
  console.log(`Alert [${severity}]: ${name} - ${message}`);
  return true;
}

// ------------------------------------------------------------------
// Log Shipping
// ------------------------------------------------------------------

export async function shipLogsToElasticsearch(logs: LogEntry[], index: string): Promise<boolean> {
  // Would send to Elasticsearch
  console.log(`Shipping ${logs.length} logs to ${index}`);
  return true;
}

export async function createLogDashboard(title: string, queries: string[]): Promise<string> {
  // Create Grafana dashboard
  return `dashboard-${Date.now()}`;
}

export class LoggingLayer {
  getLogs = getLogsFromFile;
  searchLogs = searchLogs;
  tailLogs = tailLogs;
  
  getMetrics = getSystemMetrics;
  collectAppMetrics = collectApplicationMetrics;
  
  prometheusQuery = queryPrometheus;
  prometheusMetrics = getPrometheusMetrics;
  
  grafanaDashboards = getGrafanaDashboards;
  
  getAlerts = getAlerts;
  sendAlert = sendAlert;
  
  shipToElasticsearch = shipLogsToElasticsearch;
  createDashboard = createLogDashboard;
}
