// Bundled Hebrew fonts (offline - works in a hall with no internet).
import "@fontsource-variable/heebo";
import "@fontsource-variable/assistant";
import "@fontsource-variable/rubik";
import "@fontsource-variable/frank-ruhl-libre";
import "@fontsource-variable/noto-serif-hebrew";
import "@fontsource/ibm-plex-sans-hebrew/300.css";
import "@fontsource/ibm-plex-sans-hebrew/400.css";
import "@fontsource/ibm-plex-sans-hebrew/500.css";
import "@fontsource/ibm-plex-sans-hebrew/600.css";
import "@fontsource/ibm-plex-sans-hebrew/700.css";
import "@fontsource/varela-round";
import "@fontsource/secular-one";
import "@fontsource/suez-one";
import "@fontsource/karantina/300.css";
import "@fontsource/karantina/400.css";
import "@fontsource/karantina/700.css";
import "@fontsource/amatic-sc/400.css";
import "@fontsource/amatic-sc/700.css";
import "@fontsource-variable/noto-sans-hebrew";
import "@fontsource-variable/open-sans";
import "@fontsource-variable/arimo";
import "@fontsource-variable/fredoka";
import "@fontsource-variable/playpen-sans-hebrew";
import "@fontsource-variable/noto-rashi-hebrew";
import "@fontsource/alef/400.css";
import "@fontsource/alef/700.css";
import "@fontsource/david-libre/400.css";
import "@fontsource/david-libre/500.css";
import "@fontsource/david-libre/700.css";
import "@fontsource/miriam-libre/400.css";
import "@fontsource/miriam-libre/500.css";
import "@fontsource/miriam-libre/600.css";
import "@fontsource/miriam-libre/700.css";
import "@fontsource/tinos/400.css";
import "@fontsource/tinos/700.css";
import "@fontsource/bona-nova/400.css";
import "@fontsource/bona-nova/700.css";
import "@fontsource/bellefair";
import "@fontsource/gveret-levin";
import "@fontsource/solitreo";
import "@fontsource/rubik-dirt";
import "@fontsource/rubik-wet-paint";
import "@fontsource/rubik-bubbles";
import "@fontsource/rubik-glitch";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface FontDef {
  id: string;
  label: string;
  family: string;
  weights: number[];
  kind: "sans" | "serif" | "display" | "hand" | "system";
}

const range = (a: number, b: number) => Array.from({ length: (b - a) / 100 + 1 }, (_, i) => a + i * 100);

export const FONTS: FontDef[] = [
  { id: "heebo", label: "Heebo", family: "'Heebo Variable'", weights: range(100, 900), kind: "sans" },
  { id: "assistant", label: "Assistant", family: "'Assistant Variable'", weights: range(200, 800), kind: "sans" },
  { id: "rubik", label: "Rubik", family: "'Rubik Variable'", weights: range(300, 900), kind: "sans" },
  { id: "plex", label: "IBM Plex", family: "'IBM Plex Sans Hebrew'", weights: [300, 400, 500, 600, 700], kind: "sans" },
  { id: "varela", label: "Varela Round", family: "'Varela Round'", weights: [400], kind: "sans" },
  { id: "frank", label: "Frank Ruhl", family: "'Frank Ruhl Libre Variable'", weights: range(300, 900), kind: "serif" },
  { id: "notoserif", label: "Noto Serif", family: "'Noto Serif Hebrew Variable'", weights: range(100, 900), kind: "serif" },
  { id: "secular", label: "Secular One", family: "'Secular One'", weights: [400], kind: "display" },
  { id: "suez", label: "Suez One", family: "'Suez One'", weights: [400], kind: "display" },
  { id: "karantina", label: "Karantina", family: "'Karantina'", weights: [300, 400, 700], kind: "display" },
  { id: "amatic", label: "Amatic", family: "'Amatic SC'", weights: [400, 700], kind: "hand" },
  // sans
  { id: "notosans", label: "Noto Sans", family: "'Noto Sans Hebrew Variable'", weights: range(100, 900), kind: "sans" },
  { id: "opensans", label: "Open Sans", family: "'Open Sans Variable'", weights: range(300, 800), kind: "sans" },
  { id: "arimo", label: "Arimo", family: "'Arimo Variable'", weights: range(400, 700), kind: "sans" },
  { id: "alef", label: "Alef", family: "'Alef'", weights: [400, 700], kind: "sans" },
  { id: "miriam", label: "Miriam Libre", family: "'Miriam Libre'", weights: [400, 500, 600, 700], kind: "sans" },
  { id: "fredoka", label: "Fredoka", family: "'Fredoka Variable'", weights: range(300, 700), kind: "sans" },
  // serif
  { id: "david", label: "David Libre", family: "'David Libre'", weights: [400, 500, 700], kind: "serif" },
  { id: "tinos", label: "Tinos", family: "'Tinos'", weights: [400, 700], kind: "serif" },
  { id: "bonanova", label: "Bona Nova", family: "'Bona Nova'", weights: [400, 700], kind: "serif" },
  { id: "bellefair", label: "Bellefair", family: "'Bellefair'", weights: [400], kind: "serif" },
  { id: "rashi", label: "Noto Rashi", family: "'Noto Rashi Hebrew Variable'", weights: range(100, 900), kind: "serif" },
  // display
  { id: "rubikdirt", label: "Rubik Dirt", family: "'Rubik Dirt'", weights: [400], kind: "display" },
  { id: "rubikwet", label: "Rubik Wet Paint", family: "'Rubik Wet Paint'", weights: [400], kind: "display" },
  { id: "rubikbubbles", label: "Rubik Bubbles", family: "'Rubik Bubbles'", weights: [400], kind: "display" },
  { id: "rubikglitch", label: "Rubik Glitch", family: "'Rubik Glitch'", weights: [400], kind: "display" },
  // hand
  { id: "playpen", label: "Playpen Sans", family: "'Playpen Sans Hebrew Variable'", weights: range(100, 800), kind: "hand" },
  { id: "gveret", label: "Gveret Levin", family: "'Gveret Levin'", weights: [400], kind: "hand" },
  { id: "solitreo", label: "Solitreo", family: "'Solitreo'", weights: [400], kind: "hand" },
];

/* ------------------------------------------------------------------ fonts installed on this computer */

/** Families that aren't text fonts (icons, symbols) — never offered. */
const NOT_TEXT = /(icons?|assets|emoji|symbol|wingdings|webdings|marlett|mdl2|holomdl|dingbats|^ms outlook|bookshelf symbol)/i;

export const useSystemFonts = create<{ families: string[]; loaded: boolean }>(() => ({ families: [], loaded: false }));

/** Ask the OS once for installed font families (registry), cached for the session. */
export async function loadSystemFonts() {
  if (useSystemFonts.getState().loaded) return;
  const list = await invoke<string[]>("list_system_fonts").catch(() => [] as string[]);
  const bundled = new Set(FONTS.map((f) => f.label.toLowerCase()));
  const families = list.filter((f) => !NOT_TEXT.test(f) && !/^[A-Za-z]+-[A-Za-z]+MT$|MT$/.test(f) && !bundled.has(f.toLowerCase()));
  useSystemFonts.setState({ families, loaded: true });
}

/** System fonts are stored as "sys:<Family>" so projects stay readable on other computers. */
export const SYSTEM_PREFIX = "sys:";
export const isSystemFont = (id: string | undefined) => !!id?.startsWith(SYSTEM_PREFIX);

export const WEIGHT_LABELS: Record<number, string> = {
  100: "דק מאוד",
  200: "דק",
  300: "קל",
  400: "רגיל",
  500: "בינוני",
  600: "חצי מודגש",
  700: "מודגש",
  800: "מודגש מאוד",
  900: "שחור",
};

export function fontById(id: string | undefined): FontDef {
  if (id && isSystemFont(id)) {
    const fam = id.slice(SYSTEM_PREFIX.length);
    return { id, label: fam, family: `'${fam.replace(/'/g, "")}'`, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], kind: "system" };
  }
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export function fontStack(id: string | undefined) {
  return `${fontById(id).family}, 'Heebo Variable', sans-serif`;
}

/** Nearest weight the font actually has (static fonts only ship a few). */
export function clampWeight(id: string | undefined, w: number) {
  const ws = fontById(id).weights;
  return ws.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), ws[0]);
}
