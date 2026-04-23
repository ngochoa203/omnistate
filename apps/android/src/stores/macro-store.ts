/**
 * Macro persistence store — stores user-authored macros in memory.
 * TODO: wire AsyncStorage for persistence (pattern from connection-store).
 */

import { create } from "zustand";
import type { Macro } from "../engine/types";

interface MacroState {
  macros: Macro[];
  selectedMacroId: string | null;

  addMacro: (macro: Macro) => void;
  updateMacro: (id: string, patch: Partial<Macro>) => void;
  deleteMacro: (id: string) => void;
  selectMacro: (id: string | null) => void;
  importMacros: (macros: Macro[]) => void;
  exportMacros: () => Macro[];
  findMacro: (id: string) => Macro | undefined;
}

export const useMacroStore = create<MacroState>((set, get) => ({
  macros: [],
  selectedMacroId: null,

  addMacro: (macro) => set((s) => ({ macros: [...s.macros, macro] })),

  updateMacro: (id, patch) =>
    set((s) => ({
      macros: s.macros.map((m) =>
        m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m,
      ),
    })),

  deleteMacro: (id) =>
    set((s) => ({
      macros: s.macros.filter((m) => m.id !== id),
      selectedMacroId: s.selectedMacroId === id ? null : s.selectedMacroId,
    })),

  selectMacro: (id) => set({ selectedMacroId: id }),

  importMacros: (macros) =>
    set((s) => {
      const existing = new Set(s.macros.map((m) => m.id));
      const fresh = macros.filter((m) => !existing.has(m.id));
      return { macros: [...s.macros, ...fresh] };
    }),

  exportMacros: () => get().macros,

  findMacro: (id) => get().macros.find((m) => m.id === id),
}));
