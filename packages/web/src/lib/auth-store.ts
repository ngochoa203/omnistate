import { create } from "zustand";
import { storageGetItem, storageRemoveItem, storageSetItem } from "./native-storage";

export interface VoiceProfile {
  id: string;
  name: string;
  preferredLanguage: string;
  enrolledSamples: number;
  isEnrolled: boolean;
  isVerified: boolean;
  createdAt: string;
}

interface AuthState {
  // Current user (identified by voice)
  currentProfile: VoiceProfile | null;
  profiles: VoiceProfile[];
  isEnrolled: boolean;
  isListening: boolean;
  isIdentifying: boolean;

  // Enrollment wizard state
  enrollmentStep: number; // 0=welcome, 1=recording, 2=verify, 3=done
  enrollmentSamples: number; // how many samples recorded so far
  enrollmentName: string;
  enrollmentLanguage: string;

  // Actions
  setCurrentProfile: (profile: VoiceProfile) => void;
  setProfiles: (profiles: VoiceProfile[]) => void;
  clearCurrentProfile: () => void;
  setListening: (listening: boolean) => void;
  setIdentifying: (identifying: boolean) => void;

  // Enrollment
  setEnrollmentStep: (step: number) => void;
  setEnrollmentSamples: (count: number) => void;
  setEnrollmentName: (name: string) => void;
  setEnrollmentLanguage: (lang: string) => void;
  completeEnrollment: (profile: VoiceProfile) => void;
}

function getStoredProfile(): VoiceProfile | null {
  if (typeof window === "undefined") return null;
  const stored = storageGetItem("omnistate.currentProfile");
  if (!stored) return null;
  try {
    return JSON.parse(stored) as VoiceProfile;
  } catch {
    storageRemoveItem("omnistate.currentProfile");
    return null;
  }
}

function getStoredProfiles(): VoiceProfile[] {
  if (typeof window === "undefined") return [];
  const stored = storageGetItem("omnistate.profiles");
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as VoiceProfile[]) : [];
  } catch {
    storageRemoveItem("omnistate.profiles");
    return [];
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  currentProfile: getStoredProfile(),
  profiles: getStoredProfiles(),
  isEnrolled: getStoredProfile()?.isEnrolled ?? false,
  isListening: false,
  isIdentifying: false,

  enrollmentStep: 0,
  enrollmentSamples: 0,
  enrollmentName: "",
  enrollmentLanguage: "en",

  setCurrentProfile: (profile) => {
    storageSetItem("omnistate.currentProfile", JSON.stringify(profile));
    set({ currentProfile: profile, isEnrolled: profile.isEnrolled });
  },

  setProfiles: (profiles) => {
    storageSetItem("omnistate.profiles", JSON.stringify(profiles));
    set({ profiles });
  },

  clearCurrentProfile: () => {
    storageRemoveItem("omnistate.currentProfile");
    set({ currentProfile: null, isEnrolled: false });
  },

  setListening: (isListening) => set({ isListening }),
  setIdentifying: (isIdentifying) => set({ isIdentifying }),

  setEnrollmentStep: (enrollmentStep) => set({ enrollmentStep }),
  setEnrollmentSamples: (enrollmentSamples) => set({ enrollmentSamples }),
  setEnrollmentName: (enrollmentName) => set({ enrollmentName }),
  setEnrollmentLanguage: (enrollmentLanguage) => set({ enrollmentLanguage }),

  completeEnrollment: (profile) => {
    storageSetItem("omnistate.currentProfile", JSON.stringify(profile));
    const profiles = getStoredProfiles();
    const updated = [...profiles.filter((p) => p.id !== profile.id), profile];
    storageSetItem("omnistate.profiles", JSON.stringify(updated));
    set({
      currentProfile: profile,
      profiles: updated,
      isEnrolled: true,
      enrollmentStep: 3,
      enrollmentSamples: profile.enrolledSamples,
    });
  },
}));
