import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  preferred_language: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  preferredLanguage?: string;
}

export interface UpdateUserInput {
  displayName?: string;
  preferredLanguage?: string;
  isActive?: boolean;
}

const SALT_ROUNDS = 12;

export class UserRepository {
  constructor(private db: Database.Database) {}

  async createUser(input: CreateUserInput): Promise<UserRow> {
    const id = uuid();
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, preferred_language, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.email.toLowerCase().trim(), passwordHash, input.displayName.trim(), input.preferredLanguage ?? "en", now, now);

    return this.findById(id)!;
  }

  findById(id: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }

  findByEmail(email: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as UserRow | undefined;
  }

  async verifyPassword(user: UserRow, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  }

  updateUser(id: string, updates: UpdateUserInput): UserRow | undefined {
    const sets: string[] = [];
    const values: any[] = [];

    if (updates.displayName !== undefined) {
      sets.push("display_name = ?");
      values.push(updates.displayName.trim());
    }
    if (updates.preferredLanguage !== undefined) {
      sets.push("preferred_language = ?");
      values.push(updates.preferredLanguage);
    }
    if (updates.isActive !== undefined) {
      sets.push("is_active = ?");
      values.push(updates.isActive ? 1 : 0);
    }

    if (sets.length === 0) return this.findById(id);

    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  deleteUser(id: string): void {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
  }

  listUsers(): UserRow[] {
    return this.db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as UserRow[];
  }
}
