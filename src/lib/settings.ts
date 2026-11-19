import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AppSettings {
  transition: "fade" | "cut";
  fadeMs: number;
  reverseArrows: boolean;
  preferredMonitor: number | null; // null = auto (first non-primary)
  thumbSize: number; // min tile width in px
  showNextPreview: boolean;
  theme: string;
  globalClicker: boolean;
  standby: boolean;
  standbyClock: boolean;
  fxSound: boolean;
  fxVolume: number;
  /** never let Windows sleep / turn the screens off while Bima is open */
  keepAwake: boolean;
  /** like PowerPoint: projector mirrored → switch to Extend for the show, restore after */
  autoExtend: boolean;
  /** control from Bima for Wear OS over Bluetooth */
  remoteEnabled: boolean;
  /** the paired watch (null = none yet) */
  remoteWatch: { id: string; name: string } | null;
  /** talk length for wrist alerts at 5 / 1 / 0 minutes left (0 = no alerts) */
  talkMinutes: number;
}

export const useSettings = create<AppSettings & { set: (p: Partial<AppSettings>) => void }>()(
  persist(
    (set) => ({
      transition: "fade",
      fadeMs: 350,
      reverseArrows: false,
      preferredMonitor: null,
      thumbSize: 220,
      showNextPreview: true,
      theme: "indigo",
      globalClicker: false,
      standby: true,
      standbyClock: true,
      fxSound: true,
      fxVolume: 0.8,
      keepAwake: true,
      autoExtend: true,
      remoteEnabled: false,
      remoteWatch: null,
      talkMinutes: 0,
      set: (p) => set(p),
    }),
    { name: "bima-settings" },
  ),
);
