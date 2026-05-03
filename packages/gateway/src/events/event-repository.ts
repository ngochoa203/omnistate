import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { EventIngestMessage, EventRecord, EventSeverity } from "../gateway/protocol.js";

const MAX_LIMIT = 100;
const TEXT_LIMIT = 16_000;
const SHORT_LIMIT = 240;
const SEVERITIES = new Set<EventSeverity>(["debug", "info", "warning", "error", "critical"]);

export interface EventQueryInput {
  source?: string;
  kind?: string;
  severity?: EventSeverity;
  tagsAny?: string[];
  text?: string;
  before?: string;
  limit?: number;
}

function clampLimit(limit: unknown, fallback = 50): number {
  const parsed = typeof limit === "number" ? limit : Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_LIMIT));
}

function text(value: unknown, limit = TEXT_LIMIT): string {
  return String(value ?? "").split("\u0000").join("").trim().slice(0, limit);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => text(item, 80)).filter(Boolean))).slice(0, 32);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify(null);
  }
}

function jsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function iso(value: unknown): string {
  const parsed = value ? new Date(String(value)) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

interface EventRow {
  id: string;
  source: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  tags_json: string;
  metadata_json: string;
  occurred_at: string;
  created_at: string;
}

function rowToEvent(row: EventRow): EventRecord {
  return {
    id: String(row.id),
    source: String(row.source),
    kind: String(row.kind),
    severity: SEVERITIES.has(row.severity as EventSeverity) ? (row.severity as EventSeverity) : "info",
    title: String(row.title),
    body: String(row.body ?? ""),
    tags: jsonParse<string[]>(row.tags_json, []),
    metadata: jsonParse<Record<string, unknown>>(row.metadata_json, {}),
    occurredAt: String(row.occurred_at),
    createdAt: String(row.created_at),
  };
}

export class EventRepository {
  constructor(private readonly db: Database.Database) {}

  ingest(input: EventIngestMessage): EventRecord {
    const source = text(input.source, SHORT_LIMIT);
    const kind = text(input.kind, SHORT_LIMIT);
    const title = text(input.title, 500);
    if (!source || !kind || !title) throw new Error("EVENT_INVALID_INPUT");

    const event: EventRecord = {
      id: text(input.id, 120) || uuid(),
      source,
      kind,
      severity: input.severity && SEVERITIES.has(input.severity) ? input.severity : "info",
      title,
      body: text(input.body),
      tags: stringList(input.tags),
      metadata: objectValue(input.metadata),
      occurredAt: iso(input.occurredAt),
      createdAt: new Date().toISOString(),
    };

    try {
      this.db.prepare(`
        INSERT INTO events (id, source, kind, severity, title, body, tags_json, metadata_json, occurred_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(event.id, event.source, event.kind, event.severity, event.title, event.body, jsonStringify(event.tags), jsonStringify(event.metadata), event.occurredAt, event.createdAt);
      return event;
    } catch {
      throw new Error("EVENT_STORE_FAILED");
    }
  }

  get(id: string): EventRecord | null {
    const safeId = text(id, 120);
    if (!safeId) return null;
    try {
      const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(safeId) as EventRow | undefined;
      return row ? rowToEvent(row) : null;
    } catch {
      throw new Error("EVENT_QUERY_FAILED");
    }
  }

  query(input: EventQueryInput = {}): EventRecord[] {
    const where: string[] = [];
    const values: unknown[] = [];
    if (input.source) { where.push("source = ?"); values.push(text(input.source, SHORT_LIMIT)); }
    if (input.kind) { where.push("kind = ?"); values.push(text(input.kind, SHORT_LIMIT)); }
    if (input.severity && SEVERITIES.has(input.severity)) { where.push("severity = ?"); values.push(input.severity); }
    if (input.before) { where.push("occurred_at < ?"); values.push(iso(input.before)); }
    if (input.text) {
      where.push("(title LIKE ? OR body LIKE ?)");
      const needle = `%${text(input.text, 200)}%`;
      values.push(needle, needle);
    }
    const tags = stringList(input.tagsAny);
    if (tags.length > 0) {
      where.push('(' + tags.map(() => 'tags_json LIKE ?').join(' OR ') + ')');
      for (const tag of tags) values.push(`%${tag}%`);
    }
    values.push(clampLimit(input.limit));

    try {
      const sql = `SELECT * FROM events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY occurred_at DESC, created_at DESC LIMIT ?`;
      return (this.db.prepare(sql).all(...values) as EventRow[]).map(rowToEvent);
    } catch {
      throw new Error("EVENT_QUERY_FAILED");
    }
  }
}
