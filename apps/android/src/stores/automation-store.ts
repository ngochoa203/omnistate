/**
 * Automation runtime store — tracks currently running macros and history.
 */

import { create } from "zustand";
import type { Macro, AutomationLog } from "../engine/types";

interface AutomationState {
  isRunning: boolean;
  currentMacro: Macro | null;
  currentStepIndex: number;
  status: string;
  history: AutomationLog[];

  startAutomation: (macro: Macro) => void;
  stopAutomation: () => void;
  updateStatus: (status: string) => void;
  updateStep: (index: number) => void;
  addLog: (log: AutomationLog) => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 200;

export const useAutomationStore = create<AutomationState>((set) => ({
  isRunning: false,
  currentMacro: null,
  currentStepIndex: 0,
  status: "idle",
  history: [],

  startAutomation: (macro) =>
    set({ isRunning: true, currentMacro: macro, currentStepIndex: 0, status: "running" }),

  stopAutomation: () =>
    set({ isRunning: false, currentMacro: null, currentStepIndex: 0, status: "idle" }),

  updateStatus: (status) => set({ status }),

  updateStep: (index) => set({ currentStepIndex: index }),

  addLog: (log) =>
    set((s) => ({
      history: [log, ...s.history].slice(0, MAX_HISTORY),
    })),

  clearHistory: () => set({ history: [] }),
}));
