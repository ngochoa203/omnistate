import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";

import { logger } from "../utils/logger.js";
const DB_DIR = join(homedir(), ".omnistate");
const DB_PATH = join(DB_DIR, "omnistate.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");

  runMigrations(_db);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// For testing - use in-memory database
export function getTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        preferred_language TEXT NOT NULL DEFAULT 'en',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh ON auth_sessions(refresh_token);

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `,
  },
  {
    version: 2,
    name: "task_history",
    sql: `
      CREATE TABLE IF NOT EXISTS task_history (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
        output TEXT,
        intent_type TEXT NOT NULL DEFAULT 'unknown',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        resource_impact_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_task_history_user ON task_history(user_id, created_at DESC);
    `,
  },
  {
    version: 3,
    name: "voice_embeddings",
    sql: `
      CREATE TABLE IF NOT EXISTS voice_embeddings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        embedding_json TEXT NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 1,
        threshold REAL NOT NULL DEFAULT 0.85,
        model_version TEXT NOT NULL DEFAULT 'resemblyzer-v1',
        enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_embeddings_user ON voice_embeddings(user_id);

      CREATE TABLE IF NOT EXISTS voice_samples (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        audio_hash TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        prompt_text TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_voice_samples_user ON voice_samples(user_id);
    `,
  },
  {
    version: 4,
    name: "triggers",
    sql: `
      CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        condition_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        cooldown_ms INTEGER DEFAULT 0,
        fire_count INTEGER NOT NULL DEFAULT 0,
        last_fired_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_triggers_user ON triggers(user_id);
      CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers(user_id, enabled);

      CREATE TABLE IF NOT EXISTS trigger_log (
        id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fired_at TEXT NOT NULL DEFAULT (datetime('now')),
        condition_snapshot TEXT,
        task_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('fired', 'executed', 'failed', 'skipped')),
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_trigger_log_trigger ON trigger_log(trigger_id, fired_at DESC);
    `,
  },
  {
    version: 5,
    name: "conversations",
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        task_id TEXT,
        data_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    `,
  },
  {
    version: 6,
    name: "registered_devices",
    sql: `
      CREATE TABLE IF NOT EXISTS registered_devices (
        id TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        device_type TEXT NOT NULL DEFAULT 'android',
        device_token TEXT NOT NULL UNIQUE,
        refresh_token TEXT UNIQUE,
        user_id TEXT,
        paired_via TEXT NOT NULL DEFAULT 'lan_pin',
        tailscale_ip TEXT,
        last_seen_at TEXT,
        last_seen_ip TEXT,
        is_revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_devices_token ON registered_devices(device_token);
      CREATE INDEX IF NOT EXISTS idx_devices_user ON registered_devices(user_id);
    `,
  },
];

function runMigrations(db: Database.Database): void {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare("SELECT version FROM migrations").all().map((r: any) => r.version)
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name
      );
    })();

    logger.info(`[db] Applied migration ${migration.version}: ${migration.name}`);
  }
}
