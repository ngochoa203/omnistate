/**
 * Audit Logging Tools — Advanced Layer (API 78)
 * Implements: Audit trails, compliance logs, activity tracking, forensic analysis
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface AuditEntry {
  id: string;
  timestamp: Date;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: { field: string; old?: any; new?: any }[];
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

const auditLog: AuditEntry[] = [];

export async function logAuditEvent(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<string> {
  const fullEntry: AuditEntry = {
    ...entry,
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    timestamp: new Date()
  };
  
  auditLog.push(fullEntry);
  
  // Persist to file
  const auditPath = path.join(process.cwd(), "audit", `${new Date().toISOString().split("T")[0]}.jsonl`);
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, JSON.stringify(fullEntry) + "\n");
  
  return fullEntry.id;
}

export async function getAuditLog(filters?: {
  userId?: string;
  action?: string;
  resource?: string;
  from?: Date;
  to?: Date;
}): Promise<AuditEntry[]> {
  return auditLog.filter(e => {
    if (filters?.userId && e.userId !== filters.userId) return false;
    if (filters?.action && e.action !== filters.action) return false;
    if (filters?.resource && e.resource !== filters.resource) return false;
    if (filters?.from && e.timestamp < filters.from) return false;
    if (filters?.to && e.timestamp > filters.to) return false;
    return true;
  });
}

export async function getResourceHistory(
  resourceId: string
): Promise<{ changes: AuditEntry[]; timeline: { date: Date; summary: string }[] }> {
  const changes = auditLog.filter(e => e.resourceId === resourceId);
  
  const timeline = changes.map(c => ({
    date: c.timestamp,
    summary: `${c.action} by ${c.userId || "system"}`
  }));
  
  return { changes, timeline };
}

export async function searchAuditLogs(query: string): Promise<AuditEntry[]> {
  const lowerQuery = query.toLowerCase();
  return auditLog.filter(e =>
    e.action.toLowerCase().includes(lowerQuery) ||
    e.resource.toLowerCase().includes(lowerQuery) ||
    JSON.stringify(e.changes).toLowerCase().includes(lowerQuery)
  );
}

export async function generateAuditReport(
  startDate: Date,
  endDate: Date
): Promise<{
  totalEvents: number;
  byAction: Record<string, number>;
  byUser: Record<string, number>;
  suspicious: AuditEntry[];
}> {
  const events = await getAuditLog({ from: startDate, to: endDate });
  
  const byAction: Record<string, number> = {};
  const byUser: Record<string, number> = {};
  const suspicious: AuditEntry[] = [];
  
  for (const e of events) {
    byAction[e.action] = (byAction[e.action] || 0) + 1;
    if (e.userId) byUser[e.userId] = (byUser[e.userId] || 0) + 1;
    if (e.action.includes("delete") || e.action.includes("admin")) {
      suspicious.push(e);
    }
  }
  
  return { totalEvents: events.length, byAction, byUser, suspicious };
}

export class AuditLoggingLayer {
  log = logAuditEvent;
  getLog = getAuditLog;
  getResourceHistory = getResourceHistory;
  search = searchAuditLogs;
  generateReport = generateAuditReport;
}
