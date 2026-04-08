import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionEntry } from "../types/session.js";

/**
 * Session store — persists session metadata as JSON.
 *
 * Adapted from OpenClaw's sessions.json pattern.
 */
export class SessionStore {
  private sessions: Map<string, SessionEntry> = new Map();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  set(entry: SessionEntry): void {
    entry.updatedAt = new Date().toISOString();
    this.sessions.set(entry.sessionId, entry);
    this.save();
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.save();
  }

  /** Find sessions by status. */
  findByStatus(status: SessionEntry["status"]): SessionEntry[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === status
    );
  }

  /** Get all sessions. */
  all(): SessionEntry[] {
    return Array.from(this.sessions.values());
  }

  /** Prune sessions older than the given number of days. */
  prune(maxAgeDays: number): number {
    const cutoff = Date.now() - maxAgeDays * 86400000;
    let pruned = 0;
    for (const [id, entry] of this.sessions) {
      if (new Date(entry.createdAt).getTime() < cutoff) {
        this.sessions.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) this.save();
    return pruned;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data: Record<string, SessionEntry> = JSON.parse(raw);
      this.sessions = new Map(Object.entries(data));
    } catch {
      // Corrupted file — start fresh
      this.sessions = new Map();
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const data = Object.fromEntries(this.sessions);
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
