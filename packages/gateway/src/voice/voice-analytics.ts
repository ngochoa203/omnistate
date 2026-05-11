import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const log = childLogger("voice-analytics");

export interface SessionMetrics {
  sessionId: string;
  userId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  turns: number;
  intents: Record<string, number>;
  errors: number;
  avgLatencyMs: number;
  language: string;
}

export interface IntentStats {
  intent: string;
  count: number;
  avgConfidence: number;
  successRate: number;
}

export interface LatencyStats {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface VoiceAnalytics {
  startSession(userId: string, sessionId: string, language?: string): void;
  endSession(sessionId: string): void;
  recordTurn(sessionId: string, intent: string, confidence: number, latencyMs: number): void;
  recordError(sessionId: string, errorType: string): void;
  getSessionMetrics(sessionId: string): SessionMetrics | null;
  getIntentDistribution(): IntentStats[];
  getLatencyStats(): LatencyStats;
  getTotalSessions(): number;
  getAverageSessionDuration(): number;
  getSuccessRate(): number;
  exportMetrics(): AnalyticsExport;
  reset(): void;
}

interface AnalyticsData {
  sessions: Map<string, SessionMetrics>;
  intentCounts: Map<string, number>;
  intentConfidences: Map<string, number[]>;
  intentSuccesses: Map<string, number>;
  intentFailures: Map<string, number>;
  latencies: number[];
  startTime: number;
}

const ANALYTICS_FILE = join(homedir(), ".omnistate", "voice-analytics.json");

class VoiceAnalyticsImpl extends EventEmitter implements VoiceAnalytics {
  private data: AnalyticsData;

  constructor() {
    super();
    this.data = this.createEmptyData();
    this.loadFromFile();
  }

  private createEmptyData(): AnalyticsData {
    return {
      sessions: new Map(),
      intentCounts: new Map(),
      intentConfidences: new Map(),
      intentSuccesses: new Map(),
      intentFailures: new Map(),
      latencies: [],
      startTime: Date.now(),
    };
  }

  private loadFromFile(): void {
    try {
      if (!existsSync(ANALYTICS_FILE)) return;

      const raw = readFileSync(ANALYTICS_FILE, "utf-8");
      const json = JSON.parse(raw);

      // Restore sessions
      if (json.sessions) {
        for (const [id, session] of Object.entries(json.sessions)) {
          this.data.sessions.set(id, session as SessionMetrics);
        }
      }

      // Restore intent stats
      if (json.intentCounts) {
        for (const [intent, count] of Object.entries(json.intentCounts)) {
          this.data.intentCounts.set(intent, count as number);
        }
      }

      if (json.latencies) {
        this.data.latencies = json.latencies;
      }

      log.info("Voice analytics loaded from file");
    } catch (err) {
      log.warn({ err }, "Failed to load voice analytics");
    }
  }

  private saveToFile(): void {
    try {
      const dir = join(homedir(), ".omnistate");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const json = {
        sessions: Object.fromEntries(this.data.sessions),
        intentCounts: Object.fromEntries(this.data.intentCounts),
        latencies: this.data.latencies.slice(-1000), // Keep last 1000 latencies
      };

      writeFileSync(ANALYTICS_FILE, JSON.stringify(json, null, 2), "utf-8");
    } catch (err) {
      log.warn({ err }, "Failed to save voice analytics");
    }
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }

  startSession(userId: string, sessionId: string, language = "vi"): void {
    const metrics: SessionMetrics = {
      sessionId,
      userId,
      startedAt: Date.now(),
      turns: 0,
      intents: {},
      errors: 0,
      avgLatencyMs: 0,
      language,
    };

    this.data.sessions.set(sessionId, metrics);
    log.debug({ sessionId, userId }, "Session started");

    this.emit("sessionStarted", { sessionId, userId });
  }

  endSession(sessionId: string): void {
    const metrics = this.data.sessions.get(sessionId);
    if (!metrics) return;

    metrics.endedAt = Date.now();
    metrics.durationMs = metrics.endedAt - metrics.startedAt;

    log.debug(
      { sessionId, duration: metrics.durationMs, turns: metrics.turns },
      "Session ended"
    );

    this.emit("sessionEnded", metrics);
    this.saveToFile();
  }

  recordTurn(sessionId: string, intent: string, confidence: number, latencyMs: number): void {
    const metrics = this.data.sessions.get(sessionId);
    if (!metrics) return;

    metrics.turns++;
    metrics.intents[intent] = (metrics.intents[intent] ?? 0) + 1;
    metrics.avgLatencyMs = (
      (metrics.avgLatencyMs * (metrics.turns - 1) + latencyMs) / metrics.turns
    );

    // Update global intent stats
    this.data.intentCounts.set(intent, (this.data.intentCounts.get(intent) ?? 0) + 1);

    const confidences = this.data.intentConfidences.get(intent) ?? [];
    confidences.push(confidence);
    if (confidences.length > 100) confidences.shift();
    this.data.intentConfidences.set(intent, confidences);

    // Record latency
    this.data.latencies.push(latencyMs);
    if (this.data.latencies.length > 10000) {
      this.data.latencies = this.data.latencies.slice(-5000);
    }

    // Track success/failure
    this.data.intentSuccesses.set(intent, (this.data.intentSuccesses.get(intent) ?? 0) + 1);

    this.emit("turnRecorded", { sessionId, intent, confidence, latencyMs });
  }

  recordError(sessionId: string, errorType: string): void {
    const metrics = this.data.sessions.get(sessionId);
    if (!metrics) return;

    metrics.errors++;

    log.debug({ sessionId, errorType, totalErrors: metrics.errors }, "Error recorded");

    this.emit("errorRecorded", { sessionId, errorType });
  }

  getSessionMetrics(sessionId: string): SessionMetrics | null {
    return this.data.sessions.get(sessionId) ?? null;
  }

  getIntentDistribution(): IntentStats[] {
    const stats: IntentStats[] = [];

    for (const [intent, count] of this.data.intentCounts) {
      const confidences = this.data.intentConfidences.get(intent) ?? [];
      const avgConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

      const successes = this.data.intentSuccesses.get(intent) ?? 0;
      const failures = this.data.intentFailures.get(intent) ?? 0;
      const total = successes + failures || 1;
      const successRate = successes / total;

      stats.push({ intent, count, avgConfidence, successRate });
    }

    return stats.sort((a, b) => b.count - a.count);
  }

  getLatencyStats(): LatencyStats {
    const latencies = this.data.latencies;
    return {
      p50: this.percentile(latencies, 0.50),
      p75: this.percentile(latencies, 0.75),
      p90: this.percentile(latencies, 0.90),
      p95: this.percentile(latencies, 0.95),
      p99: this.percentile(latencies, 0.99),
    };
  }

  getTotalSessions(): number {
    return this.data.sessions.size;
  }

  getAverageSessionDuration(): number {
    const sessions = Array.from(this.data.sessions.values()).filter(s => s.durationMs);
    if (sessions.length === 0) return 0;
    const total = sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    return total / sessions.length;
  }

  getSuccessRate(): number {
    const totalSuccesses = Array.from(this.data.intentSuccesses.values()).reduce((a, b) => a + b, 0);
    const totalFailures = Array.from(this.data.intentFailures.values()).reduce((a, b) => a + b, 0);
    const total = totalSuccesses + totalFailures;
    return total > 0 ? totalSuccesses / total : 1;
  }

  exportMetrics(): AnalyticsExport {
    const sessions = Array.from(this.data.sessions.values());
    const intentDistribution = this.getIntentDistribution();
    const latencyStats = this.getLatencyStats();

    return {
      exportedAt: new Date().toISOString(),
      periodStart: new Date(this.data.startTime).toISOString(),
      periodEnd: new Date().toISOString(),
      totalSessions: this.getTotalSessions(),
      averageSessionDurationMs: this.getAverageSessionDuration(),
      successRate: this.getSuccessRate(),
      latencyStats,
      intentDistribution,
      topIntents: intentDistribution.slice(0, 10),
      sessionsSummary: sessions.map(s => ({
        sessionId: s.sessionId,
        userId: s.userId,
        durationMs: s.durationMs,
        turns: s.turns,
        errors: s.errors,
        language: s.language,
      })),
    };
  }

  reset(): void {
    this.data = this.createEmptyData();
    log.info("Voice analytics reset");
    this.emit("reset");
  }
}

export interface AnalyticsExport {
  exportedAt: string;
  periodStart: string;
  periodEnd: string;
  totalSessions: number;
  averageSessionDurationMs: number;
  successRate: number;
  latencyStats: LatencyStats;
  intentDistribution: IntentStats[];
  topIntents: IntentStats[];
  sessionsSummary: Array<{
    sessionId: string;
    userId: string;
    durationMs?: number;
    turns: number;
    errors: number;
    language: string;
  }>;
}

export interface VoiceAnalytics extends EventEmitter {
  on(event: "sessionStarted", listener: (info: { sessionId: string; userId: string }) => void): this;
  on(event: "sessionEnded", listener: (metrics: SessionMetrics) => void): this;
  on(event: "turnRecorded", listener: (info: { sessionId: string; intent: string; confidence: number; latencyMs: number }) => void): this;
  on(event: "errorRecorded", listener: (info: { sessionId: string; errorType: string }) => void): this;
  on(event: "reset", listener: () => void): this;
  emit(event: "sessionStarted", info: { sessionId: string; userId: string }): boolean;
  emit(event: "sessionEnded", metrics: SessionMetrics): boolean;
  emit(event: "turnRecorded", info: { sessionId: string; intent: string; confidence: number; latencyMs: number }): boolean;
  emit(event: "errorRecorded", info: { sessionId: string; errorType: string }): boolean;
  emit(event: "reset"): boolean;
}

// Singleton export
export const voiceAnalytics: VoiceAnalytics = new VoiceAnalyticsImpl();
