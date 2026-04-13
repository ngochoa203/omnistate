import type { IncomingMessage, ServerResponse } from "node:http";
import { getDb } from "../db/database.js";
import { VoiceProfileRepository } from "../db/voice-profile-repository.js";
import { jsonResponse } from "./auth-routes.js";

type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: any) => Promise<void>;

function sanitizeProfile(row: any) {
  return {
    id: row.id,
    name: row.name,
    preferredLanguage: row.preferred_language,
    isEnrolled: Boolean(row.is_enrolled),
    enrolledSamples: row.enrolled_samples,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const createProfile: RouteHandler = async (_req, res, body) => {
  const { name, preferredLanguage } = body;
  if (!name || !name.trim()) {
    return jsonResponse(res, 400, { error: "Name is required" });
  }
  const db = getDb();
  const repo = new VoiceProfileRepository(db);
  const profile = repo.createProfile({ name, preferredLanguage });
  jsonResponse(res, 201, { profile: sanitizeProfile(profile) });
};

const listProfiles: RouteHandler = async (_req, res, _body) => {
  const db = getDb();
  const repo = new VoiceProfileRepository(db);
  const profiles = repo.listAll().map(sanitizeProfile);
  jsonResponse(res, 200, { profiles });
};

const getProfile: RouteHandler = async (req, res, _body) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const id = url.pathname.split("/").pop();
  if (!id) return jsonResponse(res, 400, { error: "Profile ID required" });

  const db = getDb();
  const repo = new VoiceProfileRepository(db);
  const profile = repo.findById(id);
  if (!profile) return jsonResponse(res, 404, { error: "Profile not found" });
  jsonResponse(res, 200, { profile: sanitizeProfile(profile) });
};

const updateProfile: RouteHandler = async (req, res, body) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const id = url.pathname.split("/").pop();
  if (!id) return jsonResponse(res, 400, { error: "Profile ID required" });

  const db = getDb();
  const repo = new VoiceProfileRepository(db);

  // Handle isEnrolled flag separately (markEnrolled)
  if (body.isEnrolled === true) {
    const current = repo.findById(id);
    if (!current) return jsonResponse(res, 404, { error: "Profile not found" });
    repo.markEnrolled(id, current.enrolled_samples || 3);
  }

  const profile = repo.updateProfile(id, body);
  if (!profile) return jsonResponse(res, 404, { error: "Profile not found" });
  jsonResponse(res, 200, { profile: sanitizeProfile(profile) });
};

const deleteProfile: RouteHandler = async (req, res, _body) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const id = url.pathname.split("/").pop();
  if (!id) return jsonResponse(res, 400, { error: "Profile ID required" });

  const db = getDb();
  const repo = new VoiceProfileRepository(db);
  repo.deleteProfile(id);
  jsonResponse(res, 200, { ok: true });
};

export interface VoiceRoutes {
  match(method: string, pathname: string): RouteHandler | null;
}

export function createVoiceRoutes(): VoiceRoutes {
  return {
    match(method: string, pathname: string): RouteHandler | null {
      // POST /api/voice/profile — create new profile
      if (method === "POST" && pathname === "/api/voice/profile") return createProfile;
      // GET /api/voice/profiles — list all profiles
      if (method === "GET" && pathname === "/api/voice/profiles") return listProfiles;
      // GET /api/voice/profile/:id — get single profile
      if (method === "GET" && pathname.startsWith("/api/voice/profile/")) return getProfile;
      // PUT /api/voice/profile/:id — update profile
      if (method === "PUT" && pathname.startsWith("/api/voice/profile/")) return updateProfile;
      // DELETE /api/voice/profile/:id — delete profile
      if (method === "DELETE" && pathname.startsWith("/api/voice/profile/")) return deleteProfile;
      return null;
    },
  };
}
