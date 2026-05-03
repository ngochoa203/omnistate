import { cpus, freemem, totalmem } from "node:os";
import { watch, type FSWatcher } from "node:fs";
import { getDb } from "../db/database.js";
import { v4 as uuid } from "uuid";
import type { EventBus } from "../events/event-bus.js";
import type { EventRecord, EventSeverity } from "../gateway/protocol.js";

import { logger } from "../utils/logger.js";
export type TriggerConditionType =
  | "cpu_threshold"
  | "memory_threshold"
  | "cron"
  | "filesystem_change"
  | "process_event"
  | "webhook"
  | "event_match";


export interface EventMatchTriggerConfig {
  source?: string;
  kind?: string;
  severity?: EventSeverity;
  tagsAny?: string[];
  text?: string;
}

export interface TriggerCondition {
  type: TriggerConditionType;
  config: Record<string, unknown>;
}

export interface TriggerAction {
  type: "execute_task";
  goal: string;
  layer?: "deep" | "surface" | "auto";
}

export interface TriggerDef {
  id: string;
  userId: string;
  name: string;
  description: string;
  condition: TriggerCondition;
  action: TriggerAction;
  enabled: boolean;
  cooldownMs: number;
  fireCount: number;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerLogEntry {
  id: string;
  trigger_id: string;
  user_id: string;
  fired_at: string;
  condition_snapshot: string;
  status: 'fired' | 'executed' | 'failed';
  error?: string;
}

export type TriggerFireCallback = (trigger: TriggerDef) => Promise<void>;

export class TriggerEngine {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private cronTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private fsWatchers: Map<string, FSWatcher> = new Map();
  private onFire: TriggerFireCallback | null = null;

  start(callback: TriggerFireCallback): void {
    this.onFire = callback;

    // Poll CPU/memory every 10 seconds
    this.pollingInterval = setInterval(() => {
      this.evaluatePollingTriggers().catch((err) => logger.error({ err }, "unhandled promise rejection"));
    }, 10_000);

    // Set up cron and filesystem triggers
    this.setupActiveTriggers().catch((err) => logger.error({ err }, "unhandled promise rejection"));

    logger.info("[triggers] Engine started");
  }

  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    for (const timer of this.cronTimers.values()) clearTimeout(timer);
    this.cronTimers.clear();
    for (const watcher of this.fsWatchers.values()) watcher.close();
    this.fsWatchers.clear();
    logger.info("[triggers] Engine stopped");
  }

  async setupActiveTriggers(): Promise<void> {
    const db = getDb();
    const triggers = db.prepare(
      "SELECT * FROM triggers WHERE enabled = 1"
    ).all() as any[];

    for (const row of triggers) {
      const trigger = this.rowToTrigger(row);
      if (trigger.condition.type === "cron") {
        this.setupCronTrigger(trigger);
      } else if (trigger.condition.type === "filesystem_change") {
        this.setupFsWatcher(trigger);
      }
    }
  }

  private async evaluatePollingTriggers(): Promise<void> {
    const db = getDb();
    const triggers = db.prepare(
      "SELECT * FROM triggers WHERE enabled = 1 AND json_extract(condition_json, '$.type') IN ('cpu_threshold', 'memory_threshold')"
    ).all() as any[];

    for (const row of triggers) {
      const trigger = this.rowToTrigger(row);

      if (!this.checkCooldown(trigger)) continue;

      let shouldFire = false;

      if (trigger.condition.type === "cpu_threshold") {
        const config = trigger.condition.config as { operator: string; value: number };
        const cpuUsage = this.getCpuUsage();
        if (config.operator === "gt" && cpuUsage > config.value) shouldFire = true;
        if (config.operator === "lt" && cpuUsage < config.value) shouldFire = true;
      } else if (trigger.condition.type === "memory_threshold") {
        const config = trigger.condition.config as { operator: string; value: number; unit: string };
        const memUsage = (1 - freemem() / totalmem()) * 100;
        const threshold = config.unit === "percent" ? config.value : (config.value / (totalmem() / 1024 / 1024)) * 100;
        if (config.operator === "gt" && memUsage > threshold) shouldFire = true;
        if (config.operator === "lt" && memUsage < threshold) shouldFire = true;
      }

      if (shouldFire) {
        await this.fireTrigger(trigger);
      }
    }
  }


  async evaluateEvent(event: EventRecord): Promise<void> {
    const db = getDb();
    const triggers = db.prepare(
      "SELECT * FROM triggers WHERE enabled = 1 AND json_extract(condition_json, '$.type') = 'event_match'"
    ).all() as any[];

    for (const row of triggers) {
      const trigger = this.rowToTrigger(row);
      if (!this.checkCooldown(trigger)) continue;
      if (this.matchesEvent(trigger.condition.config as EventMatchTriggerConfig, event)) {
        await this.fireTrigger(trigger, { eventId: event.id, event });
      }
    }
  }

  private matchesEvent(config: EventMatchTriggerConfig, event: EventRecord): boolean {
    if (config.source && config.source !== event.source) return false;
    if (config.kind && config.kind !== event.kind) return false;
    if (config.severity && config.severity !== event.severity) return false;
    if (Array.isArray(config.tagsAny) && config.tagsAny.length > 0) {
      const eventTags = new Set(event.tags.map((tag) => tag.toLowerCase()));
      const hasTag = config.tagsAny.some((tag) => eventTags.has(String(tag).toLowerCase()));
      if (!hasTag) return false;
    }
    if (config.text) {
      const needle = String(config.text).trim().toLowerCase();
      if (needle && !`${event.title} ${event.body}`.toLowerCase().includes(needle)) return false;
    }
    return true;
  }

  private setupCronTrigger(trigger: TriggerDef): void {
    const config = trigger.condition.config as { expression: string };
    const nextFire = this.getNextCronTime(config.expression);
    if (!nextFire) return;

    const delay = nextFire.getTime() - Date.now();
    if (delay <= 0) return;

    const timer = setTimeout(async () => {
      // Bug fix #14: re-fetch the trigger from DB so lastFiredAt/enabled reflect
      // the current state — the captured `trigger` object is stale after firing.
      const freshTrigger = this.getTrigger(trigger.id);
      if (freshTrigger && freshTrigger.enabled && this.checkCooldown(freshTrigger)) {
        await this.fireTrigger(freshTrigger);
      }
      // Reschedule using the fresh trigger definition
      if (freshTrigger && freshTrigger.enabled) {
        this.setupCronTrigger(freshTrigger);
      }
    }, Math.min(delay, 2147483647)); // Max setTimeout value

    this.cronTimers.set(trigger.id, timer);
  }

  private setupFsWatcher(trigger: TriggerDef): void {
    const config = trigger.condition.config as { path: string; events: string[] };
    try {
      const watcher = watch(config.path, { recursive: true }, async (eventType) => {
        if (config.events.includes(eventType) || config.events.includes("all")) {
          const freshTrigger = this.getTrigger(trigger.id);
          if (freshTrigger && freshTrigger.enabled && this.checkCooldown(freshTrigger)) {
            await this.fireTrigger(freshTrigger);
          }
        }
      });
      this.fsWatchers.set(trigger.id, watcher);
    } catch (err) {
      logger.error({ err }, `[triggers] Failed to watch ${config.path}`);
    }
  }

  private async fireTrigger(trigger: TriggerDef, context?: Record<string, unknown>): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const logId = uuid();

    // Bug fix #20: update fire_count and last_fired_at BEFORE executing the
    // action so that if the action throws/crashes, the cooldown is still respected
    // and the audit log is consistent. Use a transaction to keep log + counter atomic.
    db.transaction(() => {
      db.prepare(`
        INSERT INTO trigger_log (id, trigger_id, user_id, fired_at, condition_snapshot, status)
        VALUES (?, ?, ?, ?, ?, 'fired')
      `).run(logId, trigger.id, trigger.userId, now, JSON.stringify({ condition: trigger.condition, ...context }));

      db.prepare(`
        UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = ? WHERE id = ?
      `).run(now, trigger.id);
    })();

    logger.info({ triggerId: trigger.id, eventId: context?.eventId }, `[triggers] Fired: ${trigger.name} (${trigger.id})`);

    // Execute the action
    try {
      if (this.onFire) {
        await this.onFire(trigger);
      }
      db.prepare("UPDATE trigger_log SET status = 'executed' WHERE id = ?").run(logId);
    } catch (err: unknown) {
      db.prepare("UPDATE trigger_log SET status = 'failed', error = ? WHERE id = ?").run(err instanceof Error ? err.message : String(err), logId);
    }
  }

  private checkCooldown(trigger: TriggerDef): boolean {
    if (!trigger.lastFiredAt || trigger.cooldownMs <= 0) return true;
    const elapsed = Date.now() - new Date(trigger.lastFiredAt).getTime();
    return elapsed >= trigger.cooldownMs;
  }

  // Bug fix #5: reading cumulative ticks at a single point in time gives the
  // CPU usage since boot, not the current load. We maintain a snapshot from
  // the previous polling interval and compute the delta.
  private _prevCpuTimes: Array<ReturnType<typeof cpus>[number]["times"]> | null = null;

  private getCpuUsage(): number {
    const cpuInfo = cpus();
    const currentTimes = cpuInfo.map(c => ({ ...c.times }));

    if (!this._prevCpuTimes || this._prevCpuTimes.length !== currentTimes.length) {
      // First call or CPU count changed — store snapshot, return 0 for now
      this._prevCpuTimes = currentTimes;
      return 0;
    }

    const usages = currentTimes.map((cur, i) => {
      const prev = this._prevCpuTimes![i]!;
      const deltaIdle = cur.idle - prev.idle;
      const deltaTotal = Object.values(cur).reduce((a, b) => a + b, 0)
        - Object.values(prev).reduce((a, b) => a + b, 0);
      if (deltaTotal === 0) return 0;
      return ((deltaTotal - deltaIdle) / deltaTotal) * 100;
    });

    this._prevCpuTimes = currentTimes;
    return usages.reduce((a, b) => a + b, 0) / usages.length;
  }

  private getNextCronTime(expression: string): Date | null {
    // Simple cron parser for common patterns
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const [minute, hour] = parts;
    const now = new Date();
    const next = new Date(now);
    next.setMilliseconds(0);

    if (minute !== "*" && hour !== "*") {
      next.setMinutes(parseInt(minute, 10));
      next.setHours(parseInt(hour, 10));
      next.setSeconds(0);
      // Bug fix #15: if the computed time is already past, schedule for tomorrow
      if (next <= now) next.setDate(next.getDate() + 1);
    } else if (minute.startsWith("*/")) {
      // Bug fix #15: nextMinute can exceed 59 — use Date arithmetic instead of
      // setMinutes(>59) which silently rolls over hours unpredictably on some runtimes.
      const interval = parseInt(minute.slice(2), 10);
      if (!Number.isFinite(interval) || interval <= 0 || interval > 59) return null;
      const currentMinute = now.getMinutes();
      const minutesSinceLastTick = currentMinute % interval;
      const minutesUntilNextTick = minutesSinceLastTick === 0 ? interval : (interval - minutesSinceLastTick);
      next.setTime(now.getTime() + minutesUntilNextTick * 60_000);
      next.setSeconds(0);
      next.setMilliseconds(0);
    } else {
      // Default: next minute
      next.setTime(now.getTime() + 60_000);
      next.setSeconds(0);
      next.setMilliseconds(0);
    }

    return next;
  }

  // CRUD helpers
  createTrigger(userId: string, input: {
    name: string;
    description?: string;
    condition: TriggerCondition;
    action: TriggerAction;
    cooldownMs?: number;
  }): TriggerDef {
    const db = getDb();
    const id = uuid();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO triggers (id, user_id, name, description, condition_json, action_json, cooldown_ms, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, input.name, input.description ?? "",
      JSON.stringify(input.condition), JSON.stringify(input.action),
      input.cooldownMs ?? 60000, now, now
    );

    const trigger = this.getTrigger(id)!;

    // Set up if needed
    if (trigger.condition.type === "cron") this.setupCronTrigger(trigger);
    if (trigger.condition.type === "filesystem_change") this.setupFsWatcher(trigger);

    return trigger;
  }

  getTrigger(id: string): TriggerDef | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM triggers WHERE id = ?").get(id) as any;
    return row ? this.rowToTrigger(row) : null;
  }

  listTriggers(userId: string): TriggerDef[] {
    const db = getDb();
    // Bug fix #4: rowToTrigger is a method — must bind(this) so `this` is
    // correct inside the callback; using an arrow wrapper is the cleaner fix.
    return (db.prepare("SELECT * FROM triggers WHERE user_id = ? ORDER BY created_at DESC").all(userId) as any[])
      .map((row) => this.rowToTrigger(row));
  }

  updateTrigger(id: string, updates: Partial<{
    name: string;
    description: string;
    condition: TriggerCondition;
    action: TriggerAction;
    enabled: boolean;
    cooldownMs: number;
  }>): TriggerDef | null {
    const db = getDb();
    const sets: string[] = [];
    const values: (string | number | boolean)[] = [];

    if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name); }
    if (updates.description !== undefined) { sets.push("description = ?"); values.push(updates.description); }
    if (updates.condition !== undefined) { sets.push("condition_json = ?"); values.push(JSON.stringify(updates.condition)); }
    if (updates.action !== undefined) { sets.push("action_json = ?"); values.push(JSON.stringify(updates.action)); }
    if (updates.enabled !== undefined) { sets.push("enabled = ?"); values.push(updates.enabled ? 1 : 0); }
    if (updates.cooldownMs !== undefined) { sets.push("cooldown_ms = ?"); values.push(updates.cooldownMs); }

    if (sets.length === 0) return this.getTrigger(id);

    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE triggers SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    const trigger = this.getTrigger(id);
    if (trigger) {
      // Refresh watchers/timers
      const existingTimer = this.cronTimers.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      this.fsWatchers.get(id)?.close();
      if (trigger.enabled) {
        if (trigger.condition.type === "cron") this.setupCronTrigger(trigger);
        if (trigger.condition.type === "filesystem_change") this.setupFsWatcher(trigger);
      }
    }

    return trigger;
  }

  deleteTrigger(id: string): void {
    const timerToDelete = this.cronTimers.get(id);
    if (timerToDelete) clearTimeout(timerToDelete);
    this.fsWatchers.get(id)?.close();
    this.cronTimers.delete(id);
    this.fsWatchers.delete(id);
    getDb().prepare("DELETE FROM triggers WHERE id = ?").run(id);
  }

  getTriggerHistory(triggerId: string, limit = 50): TriggerLogEntry[] {
    return getDb().prepare(
      "SELECT * FROM trigger_log WHERE trigger_id = ? ORDER BY fired_at DESC LIMIT ?"
    ).all(triggerId, limit) as TriggerLogEntry[];
  }

  /** Bridge existing trigger fires into the EventBus. */
  bridgeToEventBus(bus: EventBus): void {
    const originalOnFire = this.onFire;
    this.onFire = async (trigger) => {
      bus.emit({
        id: uuid(),
        type: `trigger.fired`,
        source: "trigger-engine",
        payload: { triggerId: trigger.id, name: trigger.name, conditionType: trigger.condition.type },
        timestamp: Date.now(),
      });
      if (originalOnFire) await originalOnFire(trigger);
    };
  }

  private rowToTrigger(row: any): TriggerDef {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description || "",
      condition: JSON.parse(row.condition_json),
      action: JSON.parse(row.action_json),
      enabled: Boolean(row.enabled),
      cooldownMs: row.cooldown_ms ?? 60000,
      fireCount: row.fire_count ?? 0,
      lastFiredAt: row.last_fired_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
