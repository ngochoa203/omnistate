import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";

export interface VoiceProfileRow {
  id: string;
  name: string;
  preferred_language: string;
  is_enrolled: number;  // 0 or 1
  enrolled_samples: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProfileInput {
  name: string;
  preferredLanguage?: string;
}

export class VoiceProfileRepository {
  constructor(private db: Database.Database) {
    // Ensure the voice_profiles table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS voice_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        preferred_language TEXT NOT NULL DEFAULT 'en',
        is_enrolled INTEGER NOT NULL DEFAULT 0,
        enrolled_samples INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  createProfile(input: CreateProfileInput): VoiceProfileRow {
    const id = uuid();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO voice_profiles (id, name, preferred_language, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.name.trim(), input.preferredLanguage ?? "en", now, now);
    return this.findById(id)!;
  }

  findById(id: string): VoiceProfileRow | undefined {
    return this.db.prepare("SELECT * FROM voice_profiles WHERE id = ?").get(id) as VoiceProfileRow | undefined;
  }

  listAll(): VoiceProfileRow[] {
    return this.db.prepare("SELECT * FROM voice_profiles ORDER BY created_at DESC").all() as VoiceProfileRow[];
  }

  updateProfile(id: string, updates: { name?: string; preferredLanguage?: string }): VoiceProfileRow | undefined {
    const sets: string[] = [];
    const values: any[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); values.push(updates.name.trim()); }
    if (updates.preferredLanguage !== undefined) { sets.push("preferred_language = ?"); values.push(updates.preferredLanguage); }
    if (sets.length === 0) return this.findById(id);
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE voice_profiles SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  markEnrolled(id: string, sampleCount: number): void {
    this.db.prepare(`
      UPDATE voice_profiles SET is_enrolled = 1, enrolled_samples = ?, updated_at = ? WHERE id = ?
    `).run(sampleCount, new Date().toISOString(), id);
  }

  incrementSamples(id: string): number {
    this.db.prepare(`
      UPDATE voice_profiles SET enrolled_samples = enrolled_samples + 1, updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
    const row = this.findById(id);
    return row?.enrolled_samples ?? 0;
  }

  deleteProfile(id: string): void {
    this.db.prepare("DELETE FROM voice_profiles WHERE id = ?").run(id);
  }
}
