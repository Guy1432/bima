import type { ItemType } from "./types";

export interface ThemeDef {
  id: string;
  label: string;
  primary: string;
  primaryFg: string;
}

/** Operator UI accent. "Live" stays red everywhere - it's a signal, not decoration. */
export const THEMES: ThemeDef[] = [
  { id: "indigo", label: "אינדיגו", primary: "#5b56e8", primaryFg: "#ffffff" },
  { id: "blue", label: "כחול", primary: "#2563eb", primaryFg: "#ffffff" },
  { id: "cyan", label: "טורקיז", primary: "#06b6d4", primaryFg: "#04161a" },
  { id: "emerald", label: "ירוק", primary: "#10b981", primaryFg: "#03140e" },
  { id: "amber", label: "ענבר", primary: "#f59e0b", primaryFg: "#1a1203" },
  { id: "rose", label: "ורוד", primary: "#e11d48", primaryFg: "#ffffff" },
  { id: "violet", label: "סגול", primary: "#9333ea", primaryFg: "#ffffff" },
  { id: "mono", label: "מונוכרום", primary: "#fafafa", primaryFg: "#09090b" },
];

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const r = document.documentElement.style;
  r.setProperty("--primary", t.primary);
  r.setProperty("--primary-foreground", t.primaryFg);
  r.setProperty("--ring", t.primary);
}

/** Subtle per-type colour so the run-of-show is scannable at a glance. */
export const TYPE_COLOR: Record<ItemType, string> = {
  presentation: "#f97316",
  pdf: "#ef4444",
  video: "#3b82f6",
  youtube: "#f43f5e",
  image: "#10b981",
  text: "#a855f7",
};
