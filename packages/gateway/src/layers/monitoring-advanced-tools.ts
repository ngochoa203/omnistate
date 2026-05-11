/**
 * Monitoring Advanced Tools — Prometheus, Grafana, alerting, Loki.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function prometheusQuery(query: string): Promise<{ metric: string; value: number }[]> { try { const { stdout } = await execAsync(`curl -s "http://localhost:9090/api/v1/query?query=${encodeURIComponent(query)}"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.data?.result.map((r: any) => ({ metric: JSON.stringify(r.metric), value: parseFloat(r.value[1]) })) || []; } catch { return []; } }
export async function prometheusListRules(): Promise<{ name: string; group: string; health: string }[]> { try { const { stdout } = await execAsync(`curl -s "http://localhost:9090/api/v1/rules"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.data?.groups?.flatMap((g: any) => g.rules.map((r: any) => ({ name: r.name, group: g.name, health: r.health })) || []) || []; } catch { return []; } }
export async function prometheusGetTargets(): Promise<{ job: string; endpoint: string; state: string }[]> { try { const { stdout } = await execAsync(`curl -s "http://localhost:9090/api/v1/targets"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.data?.activeTargets?.map((t: any) => ({ job: t.labels?.job || "", endpoint: t.scrapeUrl, state: t.health })) || []; } catch { return []; } }

const GRAFANA_URL = process.env.GRAFANA_URL || "http://localhost:3000";
const GRAFANA_TOKEN = process.env.GRAFANA_TOKEN || "";

export async function grafanaListDashboards(): Promise<{ uid: string; title: string; folder: string }[]> { try { const { stdout } = await execAsync(`curl -s -H "Authorization: Bearer ${GRAFANA_TOKEN}" "${GRAFANA_URL}/api/search"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.filter((d: any) => d.type === "dash-db").map((d: any) => ({ uid: d.uid, title: d.title, folder: d.folderTitle || "General" })); } catch { return []; } }
export async function grafanaGetDashboard(uid: string): Promise<object> { try { const { stdout } = await execAsync(`curl -s -H "Authorization: Bearer ${GRAFANA_TOKEN}" "${GRAFANA_URL}/api/dashboards/uid/${uid}"`, { encoding: "utf-8" }); return JSON.parse(stdout).dashboard || {}; } catch { return {}; } }
export async function grafanaListDatasources(): Promise<{ name: string; type: string }[]> { try { const { stdout } = await execAsync(`curl -s -H "Authorization: Bearer ${GRAFANA_TOKEN}" "${GRAFANA_URL}/api/datasources"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.map((d: any) => ({ name: d.name, type: d.type })); } catch { return []; } }

export async function alertmanagerListAlerts(): Promise<{ name: string; status: string; severity: string }[]> { try { const { stdout } = await execAsync(`curl -s "http://localhost:9093/api/v1/alerts"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return (data.data || []).map((a: any) => ({ name: a.labels?.alertname || "", status: a.status || "unknown", severity: a.labels?.severity || "info" })); } catch { return []; } }
export async function alertmanagerSendAlert(alert: { name: string; message: string; severity?: string }): Promise<boolean> { try { const payload = JSON.stringify([{ labels: { alertname: alert.name, severity: alert.severity || "info" }, annotations: { description: alert.message } }]); await execAsync(`curl -s -X POST "http://localhost:9093/api/v1/alerts" -d '${payload}'`); return true; } catch { return false; } }

export async function queryLoki(query: string, limit = 100): Promise<{ timestamp: string; labels: object; message: string }[]> { try { const { stdout } = await execAsync(`curl -s "http://localhost:3100/loki/api/v1/query_range?query=${encodeURIComponent(query)}&limit=${limit}"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.data?.result.flatMap((s: any) => s.values.map((v: any) => ({ timestamp: v[0], labels: s.metric, message: v[1] }))) || []; } catch { return []; } }

export class MonitoringAdvancedLayer { prometheusQuery = prometheusQuery; prometheusListRules = prometheusListRules; prometheusGetTargets = prometheusGetTargets; grafanaListDashboards = grafanaListDashboards; grafanaGetDashboard = grafanaGetDashboard; grafanaListDatasources = grafanaListDatasources; alertmanagerListAlerts = alertmanagerListAlerts; alertmanagerSendAlert = alertmanagerSendAlert; queryLoki = queryLoki; }
