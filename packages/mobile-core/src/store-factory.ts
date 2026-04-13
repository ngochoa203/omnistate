import { createStore } from "zustand/vanilla";

export interface VoiceProfile {
  id: string;
  name: string;
  preferredLanguage: string;
  enrolledSamples: number;
  isEnrolled: boolean;
  isVerified: boolean;
  createdAt: string;
}

export interface AuthState {
  currentProfile: VoiceProfile | null;
  profiles: VoiceProfile[];
  isEnrolled: boolean;

  setCurrentProfile: (profile: VoiceProfile) => void;
  setProfiles: (profiles: VoiceProfile[]) => void;
  clearCurrentProfile: () => void;
}

export interface StorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export function createAuthStore(storage: StorageAdapter) {
  return createStore<AuthState>((set, get) => ({
    currentProfile: null,
    profiles: [],
    isEnrolled: false,

    setCurrentProfile: (profile) => {
      storage.setItem("omnistate.currentProfile", JSON.stringify(profile));
      set({ currentProfile: profile, isEnrolled: profile.isEnrolled });
    },

    setProfiles: (profiles) => {
      storage.setItem("omnistate.profiles", JSON.stringify(profiles));
      set({ profiles });
    },

    clearCurrentProfile: () => {
      storage.removeItem("omnistate.currentProfile");
      set({ currentProfile: null, isEnrolled: false });
    },
  }));
}

/**
 * Initialize auth store from persisted storage
 */
export async function hydrateAuthStore(
  store: ReturnType<typeof createAuthStore>,
  storage: StorageAdapter
): Promise<void> {
  const profileJson = await storage.getItem("omnistate.currentProfile");
  const profilesJson = await storage.getItem("omnistate.profiles");

  if (profilesJson) {
    try {
      store.getState().setProfiles(JSON.parse(profilesJson));
    } catch { /* ignore */ }
  }

  if (profileJson) {
    try {
      store.getState().setCurrentProfile(JSON.parse(profileJson));
    } catch { /* ignore */ }
  }
}
