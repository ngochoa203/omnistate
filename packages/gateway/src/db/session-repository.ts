import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.OMNISTATE_JWT_SECRET || "omnistate-dev-secret-change-in-production";
const ACCESS_TOKEN_EXPIRY = "7d";
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenPayload {
  userId: string;
  email: string;
  sessionId: string;
}

export class SessionRepository {
  constructor(private db: Database.Database) {}

  createSession(userId: string, email: string, meta?: { userAgent?: string; ipAddress?: string }): TokenPair {
    const sessionId = uuid();
    const refreshToken = uuid();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO auth_sessions (id, user_id, refresh_token, expires_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, userId, refreshToken, expiresAt, meta?.userAgent ?? null, meta?.ipAddress ?? null);

    const accessToken = jwt.sign(
      { userId, email, sessionId } satisfies AccessTokenPayload,
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY, jwtid: sessionId }
    );

    return { accessToken, refreshToken };
  }

  verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      return {
        userId: payload.userId,
        email: payload.email,
        sessionId: payload.sessionId,
      };
    } catch {
      return null;
    }
  }

  refreshSession(oldRefreshToken: string, email: string): TokenPair | null {
    const session = this.db.prepare(
      "SELECT * FROM auth_sessions WHERE refresh_token = ?"
    ).get(oldRefreshToken) as SessionRow | undefined;

    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      this.revokeSession(session.id);
      return null;
    }

    // Rotate refresh token
    const newRefreshToken = uuid();
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      UPDATE auth_sessions SET refresh_token = ?, expires_at = ?, last_active_at = datetime('now')
      WHERE id = ?
    `).run(newRefreshToken, newExpiresAt, session.id);

    const accessToken = jwt.sign(
      { userId: session.user_id, email, sessionId: session.id } satisfies AccessTokenPayload,
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY, jwtid: session.id }
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  revokeSession(sessionId: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
  }

  revokeAllSessions(userId: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
  }

  findSession(sessionId: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM auth_sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
  }

  touchSession(sessionId: string): void {
    this.db.prepare("UPDATE auth_sessions SET last_active_at = datetime('now') WHERE id = ?").run(sessionId);
  }

  cleanExpired(): number {
    const result = this.db.prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now')").run();
    return result.changes;
  }
}
