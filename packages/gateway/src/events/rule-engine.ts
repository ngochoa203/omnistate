import { getDb } from "../db/database.js";
import { v4 as uuid } from "uuid";
import { EventBus, type OSEvent } from "./event-bus.js";
import { logger } from "../utils/logger.js";

export type RuleActionType = "execute_task" | "run_script" | "notify" | "escalate_to_planner";

export interface EventRule {
  id: string;
  name: string;
  eventPattern: string;
  condition?: string;
  action: { type: RuleActionType; config: Record<string, unknown> };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

type RuleCallback = (rule: EventRule, event: OSEvent) => Promise<void>;

const DEFAULT_RULES: Omit<EventRule, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "Clean old DMG files",
    eventPattern: "file.created",
    condition: `payload.filename?.endsWith('.dmg')`,
    action: { type: "notify", config: { message: "New DMG detected" } },
    enabled: true,
  },
  {
    name: "DND on Zoom",
    eventPattern: "app.opened",
    condition: `payload.app === 'zoom.us'`,
    action: { type: "notify", config: { message: "Zoom opened — consider enabling DND" } },
    enabled: true,
  },
];

export class RuleEngine {
  private rules: Map<string, EventRule> = new Map();
  private unsubscribers: Map<string, () => void> = new Map();
  private onAction: RuleCallback | null = null;

  constructor(private bus: EventBus) {}

  start(callback: RuleCallback): void {
    this.onAction = callback;
    const db = getDb();

    const rows = db.prepare("SELECT * FROM event_rules ORDER BY created_at ASC").all() as any[];

    // Seed defaults if table is empty
    if (rows.length === 0) {
      for (const def of DEFAULT_RULES) {
        this.persistRule(def);
      }
    } else {
      for (const row of rows) {
        const rule = this.rowToRule(row);
        this.rules.set(rule.id, rule);
        if (rule.enabled) {
          this.subscribeRule(rule);
        }
      }
    }

    logger.info(`[rule-engine] Started with ${this.rules.size} rules`);
  }

  stop(): void {
    for (const unsub of this.unsubscribers.values()) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.unsubscribers.clear();
    logger.info("[rule-engine] Stopped");
  }

  addRule(input: Omit<EventRule, "id" | "createdAt" | "updatedAt">): EventRule {
    return this.persistRule(input);
  }

  updateRule(id: string, updates: Partial<EventRule>): EventRule | null {
    const existing = this.rules.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updated: EventRule = {
      ...existing,
      ...updates,
      id,
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    const db = getDb();
    db.prepare(`
      UPDATE event_rules SET
        name = ?,
        event_pattern = ?,
        condition_expr = ?,
        action_json = ?,
        enabled = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.eventPattern,
      updated.condition ?? null,
      JSON.stringify(updated.action),
      updated.enabled ? 1 : 0,
      now,
      id,
    );

    this.rules.set(id, updated);

    // Re-subscribe
    const unsub = this.unsubscribers.get(id);
    if (unsub) { unsub(); this.unsubscribers.delete(id); }
    if (updated.enabled) {
      this.subscribeRule(updated);
    }

    return updated;
  }

  removeRule(id: string): void {
    const unsub = this.unsubscribers.get(id);
    if (unsub) { unsub(); this.unsubscribers.delete(id); }
    this.rules.delete(id);
    getDb().prepare("DELETE FROM event_rules WHERE id = ?").run(id);
  }

  listRules(): EventRule[] {
    return Array.from(this.rules.values());
  }

  toggleRule(id: string, enabled: boolean): EventRule | null {
    return this.updateRule(id, { enabled });
  }

  private persistRule(input: Omit<EventRule, "id" | "createdAt" | "updatedAt">): EventRule {
    const id = uuid();
    const now = new Date().toISOString();
    const rule: EventRule = { ...input, id, createdAt: now, updatedAt: now };

    getDb().prepare(`
      INSERT INTO event_rules (id, name, event_pattern, condition_expr, action_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      rule.name,
      rule.eventPattern,
      rule.condition ?? null,
      JSON.stringify(rule.action),
      rule.enabled ? 1 : 0,
      now,
      now,
    );

    this.rules.set(id, rule);
    if (rule.enabled) {
      this.subscribeRule(rule);
    }

    return rule;
  }

  private subscribeRule(rule: EventRule): void {
    const unsub = this.bus.onPattern(rule.eventPattern, async (event) => {
      try {
        if (rule.condition && !this.evaluateCondition(rule.condition, event)) return;
        if (this.onAction) {
          await this.onAction(rule, event);
        }
      } catch (err) {
        logger.error({ err }, `[rule-engine] Rule "${rule.name}" action failed`);
      }
    });
    this.unsubscribers.set(rule.id, unsub);
  }

  private evaluateCondition(condition: string, event: OSEvent): boolean {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("event", "payload", "return " + condition);
      return Boolean(fn(event, event.payload));
    } catch (err) {
      logger.warn({ err, condition }, "[rule-engine] Condition evaluation failed");
      return false;
    }
  }

  private rowToRule(row: any): EventRule {
    return {
      id: row.id,
      name: row.name,
      eventPattern: row.event_pattern,
      condition: row.condition_expr ?? undefined,
      action: JSON.parse(row.action_json),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
