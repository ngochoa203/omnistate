import { create } from "zustand";

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
  const stored = localStorage.getItem("omnistate.currentProfile");
  return stored ? JSON.parse(stored) : null;
}

function getStoredProfiles(): VoiceProfile[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem("omnistate.profiles");
  return stored ? JSON.parse(stored) : [];
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
    localStorage.setItem("omnistate.currentProfile", JSON.stringify(profile));
    set({ currentProfile: profile, isEnrolled: profile.isEnrolled });
  },

  setProfiles: (profiles) => {
    localStorage.setItem("omnistate.profiles", JSON.stringify(profiles));
    set({ profiles });
  },

  clearCurrentProfile: () => {
    localStorage.removeItem("omnistate.currentProfile");
    set({ currentProfile: null, isEnrolled: false });
  },

  setListening: (isListening) => set({ isListening }),
  setIdentifying: (isIdentifying) => set({ isIdentifying }),

  setEnrollmentStep: (enrollmentStep) => set({ enrollmentStep }),
  setEnrollmentSamples: (enrollmentSamples) => set({ enrollmentSamples }),
  setEnrollmentName: (enrollmentName) => set({ enrollmentName }),
  setEnrollmentLanguage: (enrollmentLanguage) => set({ enrollmentLanguage }),

  completeEnrollment: (profile) => {
    localStorage.setItem("omnistate.currentProfile", JSON.stringify(profile));
    const profiles = getStoredProfiles();
    const updated = [...profiles.filter((p) => p.id !== profile.id), profile];
    localStorage.setItem("omnistate.profiles", JSON.stringify(updated));
    set({
      currentProfile: profile,
      profiles: updated,
      isEnrolled: true,
      enrollmentStep: 3,
      enrollmentSamples: profile.enrolledSamples,
    });
  },
}));
