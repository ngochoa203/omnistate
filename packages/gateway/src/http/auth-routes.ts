import type { IncomingMessage, ServerResponse } from "node:http";
import { getDb } from "../db/database.js";
import { UserRepository } from "../db/user-repository.js";
import { SessionRepository } from "../db/session-repository.js";

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: any) => Promise<void>;

function jsonResponse(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getAuthToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

function sanitizeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    preferredLanguage: user.preferred_language,
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

const signup: RouteHandler = async (_req, res, body) => {
  const { email, password, displayName } = body;

  if (!email || !password) {
    return jsonResponse(res, 400, { error: "Email and password are required" });
  }
  if (password.length < 6) {
    return jsonResponse(res, 400, { error: "Password must be at least 6 characters" });
  }
  if (!email.includes("@")) {
    return jsonResponse(res, 400, { error: "Invalid email format" });
  }

  const db = getDb();
  const userRepo = new UserRepository(db);
  const sessionRepo = new SessionRepository(db);

  const existing = userRepo.findByEmail(email);
  if (existing) {
    return jsonResponse(res, 409, { error: "Email already registered" });
  }

  try {
    const user = await userRepo.createUser({
      email,
      password,
      displayName: displayName || email.split("@")[0],
    });
    const tokens = sessionRepo.createSession(user.id, user.email);

    jsonResponse(res, 201, {
      user: sanitizeUser(user),
      tokens,
    });
  } catch (err: any) {
    jsonResponse(res, 500, { error: "Failed to create user: " + err.message });
  }
};

const login: RouteHandler = async (_req, res, body) => {
  const { email, password } = body;

  if (!email || !password) {
    return jsonResponse(res, 400, { error: "Email and password are required" });
  }

  const db = getDb();
  const userRepo = new UserRepository(db);
  const sessionRepo = new SessionRepository(db);

  const user = userRepo.findByEmail(email);
  if (!user) {
    return jsonResponse(res, 401, { error: "Invalid email or password" });
  }

  const valid = await userRepo.verifyPassword(user, password);
  if (!valid) {
    return jsonResponse(res, 401, { error: "Invalid email or password" });
  }

  if (!user.is_active) {
    return jsonResponse(res, 403, { error: "Account is deactivated" });
  }

  const tokens = sessionRepo.createSession(user.id, user.email, {
    userAgent: _req.headers["user-agent"],
    ipAddress: _req.socket.remoteAddress,
  });

  jsonResponse(res, 200, {
    user: sanitizeUser(user),
    tokens,
  });
};

const refresh: RouteHandler = async (_req, res, body) => {
  const { refreshToken } = body;

  if (!refreshToken) {
    return jsonResponse(res, 400, { error: "Refresh token required" });
  }

  const db = getDb();
  const sessionRepo = new SessionRepository(db);
  const userRepo = new UserRepository(db);

  const tokens = sessionRepo.refreshSession(refreshToken, ""); // email resolved from session
  if (!tokens) {
    return jsonResponse(res, 401, { error: "Invalid or expired refresh token" });
  }

  // Get updated user info
  const payload = sessionRepo.verifyAccessToken(tokens.accessToken);
  const user = payload ? userRepo.findById(payload.userId) : null;

  jsonResponse(res, 200, {
    user: user ? sanitizeUser(user) : null,
    tokens,
  });
};

const logout: RouteHandler = async (req, res, _body) => {
  const token = getAuthToken(req);
  if (!token) {
    return jsonResponse(res, 401, { error: "Not authenticated" });
  }

  const db = getDb();
  const sessionRepo = new SessionRepository(db);
  const payload = sessionRepo.verifyAccessToken(token);

  if (payload) {
    sessionRepo.revokeSession(payload.sessionId);
  }

  jsonResponse(res, 200, { ok: true });
};

const getMe: RouteHandler = async (req, res, _body) => {
  const token = getAuthToken(req);
  if (!token) {
    return jsonResponse(res, 401, { error: "Not authenticated" });
  }

  const db = getDb();
  const sessionRepo = new SessionRepository(db);
  const userRepo = new UserRepository(db);

  const payload = sessionRepo.verifyAccessToken(token);
  if (!payload) {
    return jsonResponse(res, 401, { error: "Invalid or expired token" });
  }

  const user = userRepo.findById(payload.userId);
  if (!user) {
    return jsonResponse(res, 404, { error: "User not found" });
  }

  jsonResponse(res, 200, { user: sanitizeUser(user) });
};

const updateMe: RouteHandler = async (req, res, body) => {
  const token = getAuthToken(req);
  if (!token) {
    return jsonResponse(res, 401, { error: "Not authenticated" });
  }

  const db = getDb();
  const sessionRepo = new SessionRepository(db);
  const userRepo = new UserRepository(db);

  const payload = sessionRepo.verifyAccessToken(token);
  if (!payload) {
    return jsonResponse(res, 401, { error: "Invalid or expired token" });
  }

  const { displayName, preferredLanguage } = body;
  const user = userRepo.updateUser(payload.userId, { displayName, preferredLanguage });

  if (!user) {
    return jsonResponse(res, 404, { error: "User not found" });
  }

  jsonResponse(res, 200, { user: sanitizeUser(user) });
};

export interface AuthRoutes {
  match(method: string, pathname: string): RouteHandler | null;
}

export function createAuthRoutes(): AuthRoutes {
  const routes: Record<string, Record<string, RouteHandler>> = {
    "POST": {
      "/api/auth/signup": signup,
      "/api/auth/login": login,
      "/api/auth/refresh": refresh,
      "/api/auth/logout": logout,
    },
    "GET": {
      "/api/auth/me": getMe,
    },
    "PUT": {
      "/api/auth/me": updateMe,
    },
  };

  return {
    match(method: string, pathname: string): RouteHandler | null {
      return routes[method]?.[pathname] ?? null;
    },
  };
}

export { parseBody, jsonResponse, getAuthToken, sanitizeUser };
