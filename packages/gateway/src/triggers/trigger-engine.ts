import { cpus, freemem, totalmem } from "node:os";
import { watch, type FSWatcher } from "node:fs";
import { getDb } from "../db/database.js";
import { v4 as uuid } from "uuid";

import { logger } from "../utils/logger.js";
export type TriggerConditionType =
  | "cpu_threshold"
  | "memory_threshold"
  | "cron"
  | "filesystem_change"
  | "process_event"
  | "webhook";

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

  private setupCronTrigger(trigger: TriggerDef): void {
    const config = trigger.condition.config as { expression: string };
    const nextFire = this.getNextCronTime(config.expression);
    if (!nextFire) return;

    const delay = nextFire.getTime() - Date.now();
    if (delay <= 0) return;

    const timer = setTimeout(async () => {
      if (this.checkCooldown(trigger)) {
        await this.fireTrigger(trigger);
      }
      // Reschedule
      this.setupCronTrigger(trigger);
    }, Math.min(delay, 2147483647)); // Max setTimeout value

    this.cronTimers.set(trigger.id, timer);
  }

  private setupFsWatcher(trigger: TriggerDef): void {
    const config = trigger.condition.config as { path: string; events: string[] };
    try {
      const watcher = watch(config.path, { recursive: true }, async (eventType) => {
        if (config.events.includes(eventType) || config.events.includes("all")) {
          if (this.checkCooldown(trigger)) {
            await this.fireTrigger(trigger);
          }
        }
      });
      this.fsWatchers.set(trigger.id, watcher);
    } catch (err) {
      logger.error({ err }, `[triggers] Failed to watch ${config.path}`);
    }
  }

  private async fireTrigger(trigger: TriggerDef): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const logId = uuid();

    // Log the fire event
    db.prepare(`
      INSERT INTO trigger_log (id, trigger_id, user_id, fired_at, status)
      VALUES (?, ?, ?, ?, 'fired')
    `).run(logId, trigger.id, trigger.userId, now);

    // Update trigger
    db.prepare(`
      UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = ? WHERE id = ?
    `).run(now, trigger.id);

    logger.info(`[triggers] Fired: ${trigger.name} (${trigger.id})`);

    // Execute the action
    try {
      if (this.onFire) {
        await this.onFire(trigger);
      }
      db.prepare("UPDATE trigger_log SET status = 'executed' WHERE id = ?").run(logId);
    } catch (err: any) {
      db.prepare("UPDATE trigger_log SET status = 'failed', error = ? WHERE id = ?").run(err.message, logId);
    }
  }

  private checkCooldown(trigger: TriggerDef): boolean {
    if (!trigger.lastFiredAt || trigger.cooldownMs <= 0) return true;
    const elapsed = Date.now() - new Date(trigger.lastFiredAt).getTime();
    return elapsed >= trigger.cooldownMs;
  }

  private getCpuUsage(): number {
    const cpuInfo = cpus();
    const times = cpuInfo.map(cpu => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return ((total - cpu.times.idle) / total) * 100;
    });
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  private getNextCronTime(expression: string): Date | null {
    // Simple cron parser for common patterns
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const [minute, hour] = parts;
    const now = new Date();
    const next = new Date(now);

    if (minute !== "*" && hour !== "*") {
      next.setMinutes(parseInt(minute));
      next.setHours(parseInt(hour));
      next.setSeconds(0);
      next.setMilliseconds(0);
      if (next <= now) next.setDate(next.getDate() + 1);
    } else if (minute.startsWith("*/")) {
      const interval = parseInt(minute.slice(2));
      const nextMinute = Math.ceil((now.getMinutes() + 1) / interval) * interval;
      next.setMinutes(nextMinute);
      next.setSeconds(0);
      if (next <= now) next.setMinutes(next.getMinutes() + interval);
    } else {
      // Default: next minute
      next.setMinutes(next.getMinutes() + 1);
      next.setSeconds(0);
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
    return (db.prepare("SELECT * FROM triggers WHERE user_id = ? ORDER BY created_at DESC").all(userId) as any[])
      .map(this.rowToTrigger);
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
    const values: any[] = [];

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
      this.cronTimers.get(id) && clearTimeout(this.cronTimers.get(id)!);
      this.fsWatchers.get(id)?.close();
      if (trigger.enabled) {
        if (trigger.condition.type === "cron") this.setupCronTrigger(trigger);
        if (trigger.condition.type === "filesystem_change") this.setupFsWatcher(trigger);
      }
    }

    return trigger;
  }

  deleteTrigger(id: string): void {
    this.cronTimers.get(id) && clearTimeout(this.cronTimers.get(id)!);
    this.fsWatchers.get(id)?.close();
    this.cronTimers.delete(id);
    this.fsWatchers.delete(id);
    getDb().prepare("DELETE FROM triggers WHERE id = ?").run(id);
  }

  getTriggerHistory(triggerId: string, limit = 50): any[] {
    return getDb().prepare(
      "SELECT * FROM trigger_log WHERE trigger_id = ? ORDER BY fired_at DESC LIMIT ?"
    ).all(triggerId, limit);
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
