/**
 * Analytics & Metrics Tools — Advanced Layer (API 66)
 * Implements: Event tracking, user analytics, conversion metrics, dashboards
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);


export interface AnalyticsEvent {
  name: string;
  properties: Record<string, any>;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: { type: string; query: string }[];
  refreshInterval: number;
}

export async function trackEvent(event: AnalyticsEvent): Promise<boolean> {
  try {
    const eventFile = path.join(process.cwd(), "analytics", "events", `${Date.now()}.json`);
    await fs.mkdir(path.dirname(eventFile), { recursive: true });
    await fs.writeFile(eventFile, JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}

export async function getEventCount(
  eventName: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `find analytics/events -name "*.json" -newermt "${startDate.toISOString()}" ! -newermt "${endDate.toISOString()}" | xargs grep -l "\"name\":\"${eventName}\"" 2>/dev/null | wc -l`,
      { encoding: "utf-8" }
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export async function getUserMetrics(
  userId: string
): Promise<{ sessions: number; events: number; lastSeen: Date }> {
  try {
    const { stdout } = await execAsync(
      `grep -r "\"userId\":\"${userId}\"" analytics/events 2>/dev/null | wc -l || echo "0"`,
      { encoding: "utf-8" }
    );
    return {
      sessions: Math.floor(parseInt(stdout.trim(), 10) / 10),
      events: parseInt(stdout.trim(), 10),
      lastSeen: new Date()
    };
  } catch {
    return { sessions: 0, events: 0, lastSeen: new Date() };
  }
}

export async function calculateConversionRate(
  funnelSteps: string[]
): Promise<{ step: string; users: number; dropoff: number }[]> {
  const results: { step: string; users: number; dropoff: number }[] = [];
  let prevUsers = 0;
  
  for (let i = 0; i < funnelSteps.length; i++) {
    const step = funnelSteps[i];
    const count = await getEventCount(step, new Date(Date.now() - 7 * 86400000), new Date());
    
    results.push({
      step,
      users: count,
      dropoff: prevUsers > 0 ? Math.round((prevUsers - count) / prevUsers * 100) : 0
    });
    prevUsers = count;
  }
  
  return results;
}

export async function generateAnalyticsReport(
  dateRange: { start: Date; end: Date }
): Promise<{ totalEvents: number; uniqueUsers: number; topEvents: { name: string; count: number }[] }> {
  try {
    const { stdout } = await execAsync(
      `grep -rh "\"name\":" analytics/events 2>/dev/null | sort | uniq -c | sort -rn | head -10 || echo ""`,
      { encoding: "utf-8" }
    );
    
    const topEvents = stdout.trim().split("\n").filter(l => l).map(line => {
      const [count, ...rest] = line.trim().split(/\s+/);
      const name = rest.join(" ").replace(/"/g, "");
      return { name, count: parseInt(count, 10) };
    });
    
    return { totalEvents: topEvents.reduce((s, e) => s + e.count, 0), uniqueUsers: 0, topEvents };
  } catch {
    return { totalEvents: 0, uniqueUsers: 0, topEvents: [] };
  }
}

export async function createDashboard(config: Dashboard): Promise<string> {
  const dashPath = path.join(process.cwd(), "analytics", "dashboards", `${config.id}.json`);
  await fs.mkdir(path.dirname(dashPath), { recursive: true });
  await fs.writeFile(dashPath, JSON.stringify(config));
  return dashPath;
}

export async function getFunnelAnalysis(
  startDate: Date,
  endDate: Date
): Promise<{ funnel: { step: string; count: number; rate: number }[] }> {
  const defaultFunnel = ["page_view", "sign_up", "first_purchase"];
  const funnel = await calculateConversionRate(defaultFunnel);
  
  return {
    funnel: funnel.map((f, i) => ({
      step: f.step,
      count: f.users,
      rate: i === 0 ? 100 : Math.round(f.users / funnel[0].users * 100)
    }))
  };
}

export class AnalyticsLayer {
  track = trackEvent;
  getEventCount = getEventCount;
  getUserMetrics = getUserMetrics;
  getConversionRate = calculateConversionRate;
  generateReport = generateAnalyticsReport;
  createDashboard = createDashboard;
  getFunnel = getFunnelAnalysis;
}
