import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { MemoryRecord, MemoryRecordDeleteMessage, MemoryRecordQueryMessage, MemoryRecordUpsertMessage } from "../gateway/protocol.js";

const MAX_LIMIT = 100;
const TEXT_LIMIT = 20_000;
const SCOPES = new Set<MemoryRecord["scope"]>(["global", "conversation", "user"]);

function clampLimit(limit: unknown, fallback = 50): number {
  const parsed = typeof limit === "number" ? limit : Number.parseInt(String(limit ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_LIMIT));
}

function text(value: unknown, limit = TEXT_LIMIT): string {
  return String(value ?? "").replace(/\0/g, "").trim().slice(0, limit);
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

function rowToRecord(row: any): MemoryRecord {
  return {
    id: String(row.id),
    scope: SCOPES.has(row.scope) ? row.scope : "global",
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    title: String(row.title),
    content: String(row.content),
    tags: jsonParse<string[]>(row.tags_json, []),
    metadata: jsonParse<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class MemoryRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: MemoryRecordUpsertMessage): MemoryRecord {
    const title = text(input.title, 500);
    const content = text(input.content);
    if (!title || !content) throw new Error("MEMORY_INVALID_INPUT");

    const id = text(input.id, 120) || uuid();
    const scope = input.scope && SCOPES.has(input.scope) ? input.scope : "global";
    const conversationId = text(input.conversationId, 240) || null;
    const now = new Date().toISOString();
    const existing = this.get(id);

    try {
      this.db.prepare(`
        INSERT INTO memory_records (id, scope, conversation_id, title, content, tags_json, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          conversation_id = excluded.conversation_id,
          title = excluded.title,
          content = excluded.content,
          tags_json = excluded.tags_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(id, scope, conversationId, title, content, jsonStringify(stringList(input.tags)), jsonStringify(objectValue(input.metadata)), existing?.createdAt ?? now, now);
      const record = this.get(id);
      if (!record) throw new Error("MEMORY_STORE_FAILED");
      return record;
    } catch (err) {
      if (err instanceof Error && err.message === "MEMORY_STORE_FAILED") throw err;
      throw new Error("MEMORY_STORE_FAILED");
    }
  }

  query(input: MemoryRecordQueryMessage): MemoryRecord[] {
    const where: string[] = [];
    const values: unknown[] = [];
    if (input.scope && SCOPES.has(input.scope)) { where.push("scope = ?"); values.push(input.scope); }
    if (input.conversationId) { where.push("conversation_id = ?"); values.push(text(input.conversationId, 240)); }
    if (input.before) { where.push("updated_at < ?"); values.push(iso(input.before)); }
    if (input.text) {
      where.push("(title LIKE ? OR content LIKE ?)");
      const needle = `%${text(input.text, 200)}%`;
      values.push(needle, needle);
    }
    for (const tag of stringList(input.tagsAny)) {
      where.push("tags_json LIKE ?");
      values.push(`%${tag}%`);
    }
    values.push(clampLimit(input.limit));

    try {
      const sql = `SELECT * FROM memory_records${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`;
      return (this.db.prepare(sql).all(...values) as any[]).map(rowToRecord);
    } catch {
      throw new Error("MEMORY_QUERY_FAILED");
    }
  }

  delete(input: MemoryRecordDeleteMessage): boolean {
    const id = text(input.id, 120);
    if (!id) return false;
    try {
      return this.db.prepare("DELETE FROM memory_records WHERE id = ?").run(id).changes > 0;
    } catch {
      throw new Error("MEMORY_DELETE_FAILED");
    }
  }

  private get(id: string): MemoryRecord | null {
    const row = this.db.prepare("SELECT * FROM memory_records WHERE id = ?").get(id) as any;
    return row ? rowToRecord(row) : null;
  }
}
