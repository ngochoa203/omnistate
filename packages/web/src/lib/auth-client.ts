import { useAuthStore } from "./auth-store";
import type { VoiceProfile } from "./auth-store";
import { resolveGatewayHttpBaseUrl } from "./runtime-config";

function getBaseUrl(): string {
  return resolveGatewayHttpBaseUrl();
}

async function apiCall(path: string, options: RequestInit = {}): Promise<any> {
  const baseUrl = getBaseUrl();
  const profile = useAuthStore.getState().currentProfile;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (profile) {
    headers["X-Voice-Profile-Id"] = profile.id;
  }

  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Create a new voice profile (before enrollment)
export async function createProfile(name: string, language: string): Promise<VoiceProfile> {
  const data = await apiCall("/api/voice/profile", {
    method: "POST",
    body: JSON.stringify({ name, preferredLanguage: language }),
  });
  return data.profile;
}

// Get all enrolled profiles
export async function getProfiles(): Promise<VoiceProfile[]> {
  try {
    const data = await apiCall("/api/voice/profiles");
    return data.profiles;
  } catch {
    // Keep local profiles when backend is temporarily unavailable so refresh
    // does not force re-enrollment/re-login flow.
    return useAuthStore.getState().profiles;
  }
}

// Check if any profiles are enrolled (first-run check)
export async function hasEnrolledProfiles(): Promise<boolean> {
  const profiles = await getProfiles();
  return profiles.some((p) => p.isEnrolled);
}

// Get a single profile by ID from the server
export async function getProfile(id: string): Promise<VoiceProfile | null> {
  try {
    const data = await apiCall(`/api/voice/profile/${id}`);
    return data.profile;
  } catch {
    return null;
  }
}

// Mark a profile as enrolled on the server
export async function markProfileEnrolled(id: string): Promise<VoiceProfile | null> {
  try {
    const data = await apiCall(`/api/voice/profile/${id}`, {
      method: "PUT",
      body: JSON.stringify({ isEnrolled: true }),
    });
    return data.profile;
  } catch {
    return null;
  }
}

// Sign out: clear current profile from store and localStorage
export function signOut(): void {
  useAuthStore.getState().clearCurrentProfile();
}

// Init: check for existing profiles
export async function initAuth(): Promise<void> {
  const store = useAuthStore.getState();
  const profiles = await getProfiles();
  if (profiles.length > 0) {
    store.setProfiles(profiles);
  }

  if (profiles.length === 0) {
    if (store.currentProfile) {
      // Keep current local profile during transient network/backend issues.
      return;
    }
    // No profiles, need enrollment
    store.clearCurrentProfile();
    return;
  }

  // If we have a stored current profile, verify it still exists
  if (store.currentProfile) {
    const exists = profiles.find((p) => p.id === store.currentProfile!.id);
    if (exists) {
      store.setCurrentProfile(exists);
      return;
    }
  }

  // Default to first enrolled profile
  const enrolled = profiles.find((p) => p.isEnrolled);
  if (enrolled) {
    store.setCurrentProfile(enrolled);
  }
}
