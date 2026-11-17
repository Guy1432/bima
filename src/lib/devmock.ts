/**
 * DEV-ONLY: lets the operator UI render in a plain browser (no Tauri) so design work can be
 * checked at any window size. Never runs inside the app (Tauri sets __TAURI_INTERNALS__),
 * and is tree-shaken out of production builds (import.meta.env.DEV guard in main.tsx).
 *
 * URL flags: ?signedout · ?empty (no projects) · ?workspace (open the first project)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const params = new URLSearchParams(location.search);
const signedOut = params.has("signedout");
const empty = params.has("empty");

/** Fake slide image: a page-like SVG so thumbnails look like real decks. */
function slideSvg(n: number, portrait = false, hue = 220) {
  const w = portrait ? 1240 : 1920;
  const h = portrait ? 1754 : 1080;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="hsl(${hue} 30% ${portrait ? 97 : 14}%)"/>
  <rect x="${w * 0.08}" y="${h * 0.12}" width="${w * 0.6}" height="${h * 0.07}" rx="8" fill="hsl(${hue} 60% ${portrait ? 30 : 70}%)"/>
  ${Array.from({ length: portrait ? 14 : 4 }, (_, i) => `<rect x="${w * 0.08}" y="${h * (0.28 + i * (portrait ? 0.045 : 0.1))}" width="${w * (0.5 + ((i * 37) % 30) / 100)}" height="${h * (portrait ? 0.016 : 0.035)}" rx="6" fill="hsl(${hue} 15% ${portrait ? 70 : 45}%)"/>`).join("")}
  <text x="${w * 0.92}" y="${h * 0.93}" font-family="Arial" font-size="${h * 0.05}" text-anchor="end" fill="hsl(${hue} 20% 55%)">${n}</text>
</svg>`;
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

const files: Record<string, string> = {};
// a real clip so the video trimmer can be exercised in the browser
files["demo.mp4"] = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
function img(name: string, n: number, portrait = false, hue = 220) {
  files[name] = slideSvg(n, portrait, hue);
  return name;
}

const media = { autoplay: true, loop: false, volume: 1, muted: false, advanceOnEnd: false };
const text = (title: string, subtitle = "", template = "title", extra: any = {}) => ({
  template,
  title,
  subtitle,
  body: "",
  bg: "#0b0b0f",
  fg: "#ffffff",
  fontScale: 1,
  align: "center",
  timerMinutes: 5,
  ...extra,
});

const sessionDoc = {
  version: 1,
  name: "סדנת עזרה ראשונה - מחזור 12",
  items: [
    {
      id: "i1",
      type: "text",
      title: "פתיחה",
      media,
      slides: [
        { id: "s1", content: { kind: "text", text: text("ברוכים הבאים", "סדנת עזרה ראשונה · מחזור 12") } },
        { id: "s2", content: { kind: "text", text: text("סדר היום", "", "bullets", { body: "הערכת זירה ובטיחות\nהחייאה בסיסית\nשימוש במכשיר החייאה\nתרגול בזוגות", align: "start", accent: "#ef4444", decor: "line" }) } },
        { id: "s3", content: { kind: "text", text: text("מה הדבר הראשון שעושים כשמגיעים לזירה?", "", "quote", { accent: "#f59e0b", bg: "#111827" }) } },
        { id: "s4", content: { kind: "text", text: text("שלב 1", "בדיקת הכרה ונשימה", "title", { bg: "#ffffff", fg: "#0a0a0a", accent: "#ef4444", decor: "bar" }) } },
        { id: "s5", content: { kind: "text", text: text("", "", "timer", { title: "הפסקה", subtitle: "נחזור בעוד", timerMinutes: 10 }) } },
        { id: "s6", content: { kind: "text", text: text("סרקו לטופס המשוב", "לוקח דקה", "qr", { body: "https://forms.gle/example", accent: "#6366f1" }) } },
      ],
    },
    {
      id: "i2",
      type: "presentation",
      title: "החייאת מכשירים",
      media,
      slides: Array.from({ length: 38 }, (_, k) => ({
        id: "p" + k,
        content: { kind: "image", file: img(`deck_${k}.png`, k + 1, false, 200 + ((k * 13) % 80)), aspect: 16 / 9 },
        hidden: k === 6,
      })),
    },
    {
      id: "i3",
      type: "pdf",
      title: "פרוטוקול הנחיות - PDF",
      media,
      slides: Array.from({ length: 6 }, (_, k) => ({
        id: "d" + k,
        content: { kind: "image", file: img(`doc_${k}.png`, k + 1, true, 30), aspect: 1240 / 1754 },
      })),
    },
    { id: "i4", type: "video", title: "סרטון הדגמה.mp4", media, slides: [{ id: "v1", content: { kind: "video", file: "demo.mp4" } }] },
    { id: "i5", type: "youtube", title: "שיר סיום", media, slides: [{ id: "y1", content: { kind: "youtube", videoId: "dQw4w9WgXcQ" } }] },
    {
      id: "i6",
      type: "text",
      title: "שאלות ותשובות",
      media,
      slides: [{ id: "q1", content: { kind: "text", text: text("שאלות?", "", "title") } }],
    },
  ],
};

const sessions = empty
  ? []
  : [
      { id: "a1", name: sessionDoc.name, items: 6, updated: Date.now() - 1000 * 60 * 12, cover: sessionDoc.items[0].slides[0] },
      { id: "a2", name: "הרצאה - מנהיגות בצוות", items: 4, updated: Date.now() - 1000 * 60 * 60 * 26, cover: sessionDoc.items[1].slides[3] },
      { id: "a3", name: "כנס מדריכים 2026", items: 11, updated: Date.now() - 1000 * 60 * 60 * 24 * 6, cover: sessionDoc.items[2].slides[0] },
      { id: "a4", name: "מפגש חדש", items: 0, updated: Date.now() - 1000 * 60 * 60 * 24 * 20, cover: null },
    ];

let savedJson = JSON.stringify(sessionDoc);
let savedAt = Date.now();
let cbId = 1;
const handlers: Record<string, (args: any) => any> = {
  get_media_dir: () => "C:\\mock\\media",
  list_sessions: () => sessions,
  // remember saves, so the app's "changed on disk?" check sees its own writes
  load_session: () => ({ json: savedJson, mtime: savedAt }),
  save_session: (a: any) => {
    savedJson = a?.json ?? savedJson;
    savedAt = Date.now();
    return savedAt;
  },
  session_mtime: () => savedAt,
  new_session_id: () => "n" + Math.random().toString(36).slice(2, 8),
  get_library: () => ({ root: "C:\\Users\\me\\AppData\\Roaming\\com.bima.projector", mediaDir: "C:\\mock\\media", isDefault: true }),
  list_monitors: () => [
    { index: 0, name: "Built-in", width: 2880, height: 1800, x: 0, y: 0, scale: 2, primary: true },
    { index: 1, name: "Projector", width: 1920, height: 1080, x: 1440, y: 0, scale: 1, primary: false },
  ],
  is_projector_open: () => false,
  cloud_status: () => (signedOut ? { signedIn: false, account: null } : { signedIn: true, account: { id: "u1", email: "guy@example.com" } }),
  cloud_access_token: () => {
    throw new Error("mock");
  },
  detect_cloud_folders: () => [],
  screen_count: () => 2,
  write_export: (bytes: any) => {
    (window as any).__lastExport = bytes;
  },
};

if (import.meta.env.DEV && !(window as any).__TAURI_INTERNALS__) (window as any).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  transformCallback: () => cbId++,
  unregisterCallback: () => {},
  convertFileSrc: (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? "";
    return files[name] ?? slideSvg(0);
  },
  invoke: async (cmd: string, args: any) => {
    if (cmd.startsWith("plugin:event|listen")) return cbId++;
    // export: pretend the user picked a file; keep the bytes for inspection
    if (cmd === "plugin:dialog|save") return "C:\\mock\\export." +(args?.options?.filters?.[0]?.extensions?.[0] ?? "bin");
    if (cmd.startsWith("plugin:")) return null;
    const h = handlers[cmd];
    if (h) return h(args);
    return null;
  },
};
if (import.meta.env.DEV) (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ ??= { unregisterListener: () => {} };

export const devWorkspace = params.has("workspace");
