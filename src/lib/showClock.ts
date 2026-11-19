import { create } from "zustand";

/** The show clock ("משך"): time since the talk started. Shared by the live panel and the watch. */
export const useShowClock = create<{ since: number; reset: () => void }>((set) => ({
  since: Date.now(),
  reset: () => set({ since: Date.now() }),
}));
